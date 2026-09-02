"""调用 FastGPT 上的拼豆图纸识别插件。

链路是两步，不能省：
1. `presignChatFilePostUrl` 拿一个 S3 预签名地址，把图片 PUT 上去，得到 previewUrl；
2. 用那些 previewUrl 作为插件入参 `images` 调 `/v1/chat/completions`。

插件的 `images` 是 fileSelect 类型，**只吃 URL，不吃 base64 data URL**——直接塞
data URL 会被拒为 "Invalid workflow plugin file"。

识别可能很慢，所以这里的超时默认给到 20 分钟，并且整个调用是在后台线程里跑的
（见 routers/patterns.py），前台不会被卡住。
"""

from __future__ import annotations

import concurrent.futures as cf
import logging
import os
import uuid
from collections import Counter
from dataclasses import dataclass, field

import httpx

from app.config import Settings
from app.imaging import INLINE_LIMIT, fit_inline, normalise_name, sniff_image
from app.text_parse import parse_lines

log = logging.getLogger("pindou.fastgpt")


class FastGPTError(RuntimeError):
    """调用失败，且已经把所有候选模型都试过了。"""


@dataclass(frozen=True)
class PatternResult:
    """插件输出。字段与工作流 pluginOutput 一一对应。"""

    is_extraction: bool
    #: "色号, 数量" 每行一条——正好是「按图扣减」输入框的格式
    bead_list: str
    #: Markdown 表格，行是色号、列是图片
    md_table: str
    nl_response: str
    model: str


def _headers(settings: Settings) -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.fastgpt_api_key}"}


def upload_image(
    client: httpx.Client, settings: Settings, data: bytes, filename: str, chat_id: str
) -> str:
    """把一张图传到 FastGPT，返回可公开访问的 previewUrl。"""
    filename, content_type = normalise_name(filename, data)
    base = settings.fastgpt_base_url.rstrip("/")

    res = client.post(
        f"{base}/core/chat/file/presignChatFilePostUrl",
        headers={**_headers(settings), "Content-Type": "application/json"},
        json={
            "appId": settings.fastgpt_app_id,
            "chatId": chat_id,
            "filename": filename,
            "contentType": content_type,
            "size": len(data),
        },
    )
    res.raise_for_status()
    presign = res.json()["data"]
    if presign.get("uploadMode") != "single":
        # 分片上传要另外一套流程；当前图纸都是 MB 级，走不到这里。
        raise FastGPTError(f"暂不支持的上传方式: {presign.get('uploadMode')}")

    put = client.put(presign["url"], content=data, headers=presign.get("headers") or {})
    if put.status_code not in (200, 204):
        raise FastGPTError(f"上传图片失败 HTTP {put.status_code}")
    return presign["previewUrl"]


def _invoke(
    client: httpx.Client, settings: Settings, image_urls: list[str], model: str
) -> PatternResult:
    base = settings.fastgpt_base_url.rstrip("/")
    res = client.post(
        f"{base}/v1/chat/completions",
        headers={**_headers(settings), "Content-Type": "application/json"},
        json={
            "appId": settings.fastgpt_app_id,
            "stream": False,
            "detail": True,
            "variables": {
                "images": image_urls,
                "model_name": model,
                "query": "请提取图中的色号统计",
            },
        },
    )
    res.raise_for_status()
    payload = res.json()

    if payload.get("error"):
        raise FastGPTError(str(payload["error"])[:200])

    plugin_output = None
    used_model = model
    for seg in payload.get("responseData") or []:
        if seg.get("moduleType") == "chatNode" and seg.get("model"):
            # 工作流里实际跑的模型。目前它恒等于写死的 kimi-k3——见 README 的说明。
            used_model = str(seg["model"])
        if seg.get("moduleType") == "pluginOutput":
            plugin_output = seg.get("pluginOutput")

    if not isinstance(plugin_output, dict):
        raise FastGPTError("插件没有返回 pluginOutput")

    return PatternResult(
        is_extraction=bool(plugin_output.get("is_extraction")),
        bead_list=str(plugin_output.get("bead_list") or ""),
        md_table=str(plugin_output.get("md_table") or ""),
        nl_response=str(plugin_output.get("nl_response") or ""),
        model=used_model,
    )


@dataclass
class ImageOutcome:
    """一张图最后怎么样了。每张都有一条，成功失败都记。"""

    #: 在送进来的这批图里的序号，也就是这张图在 job.images 里的位置——前端拿它
    #: 去 /api/patterns/{id}/images/{index} 取原图
    index: int
    filename: str
    #: ok | failed
    status: str
    error: str = ""
    #: 压缩做了什么、色差多少之类，给用户看的提醒
    notes: list[str] = field(default_factory=list)


@dataclass
class BatchResult:
    """整批的合并结果，外加每张图的下场。"""

    is_extraction: bool
    bead_list: str
    md_table: str
    nl_response: str
    model: str
    outcomes: list[ImageOutcome] = field(default_factory=list)

    @property
    def ok_count(self) -> int:
        return sum(1 for o in self.outcomes if o.status == "ok")


def _counts(text: str) -> Counter[str]:
    out: Counter[str] = Counter()
    for line in parse_lines(text):
        if line.status == "ok" and line.code and line.qty:
            out[line.code] += line.qty
    return out


def _table(per_image: list[Counter[str]]) -> str:
    """「色号 × 图片N」的明细表，末尾带合计列和两行统计。

    列头必须写成"图片N"：前端拿它反查 /api/patterns/{id}/images/{N-1}，让用户
    点一下就能对着原图核一个可疑的数字。N 是这张图在 job.images 里的位置，也就
    是通过了校验、真的存下来的那些图的序号——被挡在门外的那几张没有原图可看，
    自然也不占列。

    各批的表不能直接拼：模型返回的表列是它自己编的，并行跑出来的几张对不齐。
    现在一张一个请求，每一列的归属是确定的，重建反而比拼接更准。
    """
    codes = sorted(
        {c for col in per_image for c in col},
        key=lambda c: (-sum(col.get(c, 0) for col in per_image), c),
    )
    if not codes:
        return ""
    n = len(per_image)
    head = ["色号", *(f"图片{i + 1}" for i in range(n))] + (["合计"] if n > 1 else [])
    lines = [
        "| " + " | ".join(head) + " |",
        "| " + " | ".join(["---"] * len(head)) + " |",
    ]
    for c in codes:
        cells = [str(col[c]) if col.get(c) else "" for col in per_image]
        total = sum(col.get(c, 0) for col in per_image)
        lines.append("| " + " | ".join([c, *cells] + ([str(total)] if n > 1 else [])) + " |")
    kinds = [str(len(col)) for col in per_image]
    beads = [str(sum(col.values())) for col in per_image]
    lines.append("| " + " | ".join(
        ["色号数量", *kinds] + ([str(len(codes))] if n > 1 else [])) + " |")
    lines.append("| " + " | ".join(
        ["总豆数", *beads]
        + ([str(sum(sum(col.values()) for col in per_image))] if n > 1 else [])) + " |")
    return "\n".join(lines)


def _merge(
    results: list[tuple[list[int], PatternResult]], n_images: int
) -> tuple[bool, str, str, str]:
    """合并各次请求的结果。

    每次请求只送一张图（见 recognise），所以每份结果都能落到确定的一列上，
    明细表按图片重建。批大小若被调大到一次多张，那批的结果无法拆到具体某张，
    这时退回不带列的汇总表——宁可信息少，也不能编一个看着像真的归属。
    """
    total: Counter[str] = Counter()
    per_image: list[Counter[str]] = [Counter() for _ in range(n_images)]
    attributable = True
    any_extraction = False
    for idx, r in results:
        if r.is_extraction:
            any_extraction = True
        c = _counts(r.bead_list)
        total += c
        if len(idx) == 1 and 0 <= idx[0] < n_images:
            per_image[idx[0]] += c
        else:
            attributable = False

    ordered = sorted(total.items(), key=lambda kv: (-kv[1], kv[0]))
    bead_list = "\n".join(f"{code}, {qty}" for code, qty in ordered)
    if attributable:
        md_table = _table(per_image)
    elif ordered:
        md_table = "\n".join(
            ["| 色号 | 数量 |", "| --- | --- |", *(f"| {c} | {q} |" for c, q in ordered)]
        )
    else:
        md_table = ""

    # 自己写这句话，而不是把每次请求的原话拼起来：一张一个请求之后，模型每次都说
    # "已从 1 张图片中…"，六张图就是六句一模一样的废话。
    done = sum(1 for col in per_image if col) if attributable else len(results)
    note = (
        f"已从 {done} 张图片中共提取到 {len(ordered)} 种色号，"
        f"合计 {sum(total.values())} 颗拼豆。"
        if ordered
        else "\n".join(dict.fromkeys(r.nl_response for _, r in results if r.nl_response))
    )
    return any_extraction, bead_list, md_table, note


def recognise(
    images: list[tuple[str, bytes]], settings: Settings
) -> BatchResult:
    """上传图片并识别，分小批并行，逐图记录成败。

    为什么一张一张送：一次喂给模型的图越多，幻觉越严重——它会把不同图纸的色号
    串在一起。一张一个请求还有个附带好处，成败天然落在具体某张图上。批大小可配，
    调大之后下面那套"整批失败就拆开重试"的逻辑会接管归因。

    为什么要并行：二十张串行就是几十分钟。请求之间没有依赖，直接并发。

    模型选择：压不进内联预算的图不能走 Kimi（上游对内联媒体卡 2 MiB），这类批次
    直接从吃 URL 的模型开始试。
    """
    if not settings.fastgpt_configured:
        raise FastGPTError("未配置 FastGPT（PINDOU_FASTGPT_BASE_URL / _API_KEY / _APP_ID）")
    if not images:
        raise ValueError("没有图片")

    chat_id = str(uuid.uuid4())
    models = settings.fastgpt_model_list or ["kimi-k3"]
    big_models = [m for m in models if not _is_inline_limited(m, settings)] or models[-1:]
    per_batch = max(1, settings.fastgpt_images_per_request)

    outcomes = [ImageOutcome(i, name, "failed", "未处理") for i, (name, _) in enumerate(images)]

    with httpx.Client(timeout=settings.fastgpt_timeout, follow_redirects=True) as client:
        # 上传阶段就逐图隔离：一张传不上去，其余照常。
        uploaded: list[tuple[int, str, bool, int]] = []  # (下标, url, 压进预算了吗, 字节数)
        for i, (name, data) in enumerate(images):
            try:
                fitted = fit_inline(data, settings.inline_budget)
                url = upload_image(client, settings, fitted.data, name, chat_id)
            except Exception as exc:  # noqa: BLE001 - 单张失败不影响别人
                log.warning("第 %d 张上传失败：%s", i + 1, exc)
                outcomes[i] = ImageOutcome(i, name, "failed", _brief(exc))
                continue
            outcomes[i] = ImageOutcome(i, name, "ok", notes=list(fitted.notes))
            uploaded.append((i, url, fitted.within_budget, fitted.size))

        if not uploaded:
            raise FastGPTError("所有图片都上传失败了")
        log.info("已上传 %d/%d 张图到 FastGPT", len(uploaded), len(images))

        batches = [uploaded[i : i + per_batch] for i in range(0, len(uploaded), per_batch)]
        results: list[tuple[list[int], PatternResult]] = []

        def run(batch):
            idx = [i for i, _, _, _ in batch]
            urls = [u for _, u, _, _ in batch]
            # 上限卡的是**一次请求内所有内联图片之和**，不是单张——这是从线上日志
            # 对出来的：一次 3 张的请求报 2,244,894，正好等于其中两张之和；一次
            # 6 张的报 3,609,950，正好等于前五张之和。所以除了"每张有没有压进
            # 各自那份预算"，整批的实际总和也得看。
            total = sum(n for _, _, _, n in batch)
            fits = all(ok for _, _, ok, _ in batch) and total <= INLINE_LIMIT
            return idx, urls, _try_models(client, settings, urls,
                                          models if fits else big_models)

        with cf.ThreadPoolExecutor(max_workers=settings.fastgpt_concurrency) as pool:
            for idx, urls, (res, err) in pool.map(run, batches):
                if res is not None:
                    results.append((idx, res))
                    continue
                # 整批失败。批里不止一张时拆开重跑，把责任落到具体的图上；只有
                # 一张就没什么可拆的，直接记账，别白白再打一次网关。
                if len(idx) == 1:
                    outcomes[idx[0]] = ImageOutcome(
                        idx[0], images[idx[0]][0], "failed", err or "识别失败",
                        notes=outcomes[idx[0]].notes,
                    )
                    continue
                log.info("一批 %d 张失败（%s），拆开重试", len(idx), err)
                for i, url in zip(idx, urls):
                    single, serr = _try_models(client, settings, [url], models)
                    if single is not None:
                        results.append(([i], single))
                    else:
                        outcomes[i] = ImageOutcome(
                            i, images[i][0], "failed", serr or "识别失败",
                            notes=outcomes[i].notes,
                        )

    if not results:
        raise FastGPTError("所有图片都识别失败了")

    extracted, bead_list, md_table, note = _merge(results, len(images))
    model = next((r.model for _, r in results if r.model), models[0])
    return BatchResult(extracted, bead_list, md_table, note, model, outcomes)


def _brief(exc: Exception) -> str:
    """给用户看的一句话，不带网关原文里可能夹带的凭据。"""
    if isinstance(exc, (FastGPTError, ValueError)):
        return str(exc)[:200]
    return f"{type(exc).__name__}"


def _is_inline_limited(model: str, settings: Settings) -> bool:
    """这个模型是不是走"把图转成 base64 内联"的那条链路。

    判断放在配置里而不是写死模型名：换网关、换模型都不该来改代码。
    """
    return any(k and k in model for k in settings.inline_limited_list)


def _try_models(
    client: httpx.Client, settings: Settings, urls: list[str], models: list[str]
) -> tuple[PatternResult | None, str]:
    """按顺序试模型，返回 (结果, 失败说明)。全失败就是 (None, 说明)。"""
    failures: list[str] = []
    for model in models:
        try:
            return _invoke(client, settings, urls, model), ""
        except Exception as exc:  # noqa: BLE001 - 任何失败都只是"换下一个"
            log.warning("FastGPT 用 %s 失败：%s", model, exc.__class__.__name__)
            failures.append(f"{model}: {_brief(exc)}")
    return None, "；".join(failures)


# --- 本地图片留存 ---------------------------------------------------------
# 用户之后还要回看自己传了什么图，所以除了传给 FastGPT，本地也存一份原图。
# FastGPT 的 previewUrl 是公开可访问的，不能作为唯一副本：它既不受我们控制，
# 也没法保证保留多久。


def save_upload(root: str, user_id: int, filename: str, data: bytes) -> str:
    """存一张原图，返回相对存储根目录的路径。

    后缀同样按内容定，不按传进来的文件名——否则本地这份副本会以 .png 存着一个
    JPEG，用户回看时浏览器多半还能显示，但下次要拿它重传就又会踩同一个坑。
    """
    sniffed = sniff_image(data)
    if sniffed is not None:
        ext = sniffed[0]
    else:
        ext = os.path.splitext(filename)[1].lower() or ".png"
        if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"):
            ext = ".png"
    rel = f"{user_id}/{uuid.uuid4().hex}{ext}"
    full = os.path.join(root, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(data)
    return rel


def read_upload(root: str, rel: str) -> bytes:
    # rel 全部由 save_upload 生成，但读之前仍然确认它没有跳出存储根目录。
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(os.path.realpath(root) + os.sep):
        raise ValueError("非法的图片路径")
    with open(full, "rb") as f:
        return f.read()
