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

import logging
import mimetypes
import os
import uuid
from dataclasses import dataclass

import httpx

from app.config import Settings

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


# 文件头 -> (后缀, MIME)，先匹配到的算数。
#
# 为什么不能信文件名：FastGPT 上传时会嗅探内容，一旦后缀和真实类型对不上就直接
# 拒掉（UploadFileTypeMismatch，返回 500），而且它注释里写明了故意不帮忙改名。
# 而用户手上的图纸大量来自微信/QQ 转存，JPEG 被存成 .png 是常态不是特例——手上
# 6 张样例里就有 2 张是这样。
_MAGIC: tuple[tuple[bytes, str, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", ".png", "image/png"),
    (b"\xff\xd8\xff", ".jpg", "image/jpeg"),
    (b"GIF87a", ".gif", "image/gif"),
    (b"GIF89a", ".gif", "image/gif"),
    (b"BM", ".bmp", "image/bmp"),
)


def sniff_image(data: bytes) -> tuple[str, str] | None:
    """从字节本身判断图片类型，返回 (后缀, MIME)；不认识就返回 None。"""
    for magic, ext, mime in _MAGIC:
        if data.startswith(magic):
            return ext, mime
    # WebP 是 RIFF 容器，类型标在第 8-12 字节
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp", "image/webp"
    return None


def normalise_name(filename: str, data: bytes) -> tuple[str, str]:
    """把文件名的后缀改成和内容一致，返回 (文件名, MIME)。

    认不出类型时保持原样，把判断交给服务端——这里的职责是消除"后缀在说谎"这一种
    情况，不是替服务端做格式白名单。
    """
    sniffed = sniff_image(data)
    if sniffed is None:
        return filename, mimetypes.guess_type(filename)[0] or "application/octet-stream"
    ext, mime = sniffed
    stem = os.path.splitext(filename or "")[0] or "image"
    return stem + ext, mime


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


def recognise(
    images: list[tuple[str, bytes]], settings: Settings
) -> PatternResult:
    """上传图片并识别。按配置的模型顺序降级。

    `images` 是 (文件名, 字节) 的列表。
    """
    if not settings.fastgpt_configured:
        raise FastGPTError("未配置 FastGPT（PINDOU_FASTGPT_BASE_URL / _API_KEY / _APP_ID）")
    if not images:
        raise ValueError("没有图片")

    chat_id = str(uuid.uuid4())
    models = settings.fastgpt_model_list or ["kimi-k3"]

    with httpx.Client(timeout=settings.fastgpt_timeout, follow_redirects=True) as client:
        urls = [
            upload_image(client, settings, data, name, chat_id) for name, data in images
        ]
        log.info("已上传 %d 张图到 FastGPT", len(urls))

        failures: list[str] = []
        for model in models:
            try:
                return _invoke(client, settings, urls, model)
            except Exception as exc:  # noqa: BLE001 - 任何失败都只是"换下一个"
                log.warning("FastGPT 用 %s 失败：%s", model, exc.__class__.__name__)
                failures.append(f"{model}: {type(exc).__name__}")

    raise FastGPTError("所有模型都失败了：" + "；".join(failures))


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
