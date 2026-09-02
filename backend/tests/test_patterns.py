"""图纸识别任务：VIP 门禁、后台执行、红点、原图回看。

FastGPT 全部打桩，测试不打真实网关。
"""

import io
import os
import time

import pytest
from sqlalchemy import select

from app.db import get_sessionmaker
from app.fastgpt import BatchResult, ImageOutcome, read_upload, save_upload
from app.models import PatternJob, User
from tests.conftest import XRW

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01" + b"0" * 64


def _set_vip(username: str, value: bool) -> None:
    with get_sessionmaker()() as session:
        user = session.scalar(select(User).where(User.username == username))
        assert user is not None
        user.is_vip = value
        session.commit()


def _files(n: int = 1):
    return [("files", (f"p{i}.png", io.BytesIO(PNG), "image/png")) for i in range(n)]


def _wait_for(client, job_id: int, status: str, timeout: float = 5.0):
    """后台线程是真线程，得等它跑完。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/patterns/{job_id}").json()
        if job["status"] == status:
            return job
        time.sleep(0.02)
    raise AssertionError(f"任务没有进入 {status}，当前 {job['status']}")


@pytest.fixture()
def vip_client(auth_client, monkeypatch, tmp_path):
    _set_vip("tester", True)
    monkeypatch.setenv("PINDOU_FASTGPT_BASE_URL", "https://fastgpt.example/api")
    monkeypatch.setenv("PINDOU_FASTGPT_API_KEY", "fastgpt-test")
    monkeypatch.setenv("PINDOU_FASTGPT_APP_ID", "app123")
    monkeypatch.setenv("PINDOU_UPLOAD_DIR", str(tmp_path / "uploads"))
    from app.config import get_settings

    get_settings.cache_clear()
    yield auth_client
    get_settings.cache_clear()


def _stub_ok(monkeypatch, bead_list="A1, 10\nB2, 5", model="kimi-k3", is_extraction=True,
             fail: set[int] | None = None):
    """把 recognise 打桩。`fail` 里的下标当作那几张图没认出来。"""
    failed = fail or set()

    def fake(images, settings):
        return BatchResult(
            is_extraction=is_extraction,
            bead_list=bead_list,
            md_table="| 色号 | 数量 |\n| --- | --- |\n| A1 | 10 |",
            nl_response=f"已从 {len(images)} 张图片中提取",
            model=model,
            outcomes=[
                ImageOutcome(i, name, "failed" if i in failed else "ok",
                             "识别失败" if i in failed else "")
                for i, (name, _) in enumerate(images)
            ],
        )

    monkeypatch.setattr("app.routers.patterns.recognise", fake)


# ---------- 门禁 ----------


def test_a_normal_account_cannot_start_a_job(auth_client):
    res = auth_client.post("/api/patterns", files=_files(), headers=XRW)
    assert res.status_code == 403
    assert res.json()["detail"] == "VIP only"


def test_a_normal_account_cannot_list_jobs(auth_client):
    assert auth_client.get("/api/patterns").status_code == 403


def test_anonymous_is_refused(client):
    assert client.post("/api/patterns", files=_files(), headers=XRW).status_code == 401


# ---------- 上传校验 ----------


def test_rejects_a_non_image(vip_client):
    res = vip_client.post(
        "/api/patterns",
        files=[("files", ("x.txt", io.BytesIO(b"hi"), "text/plain"))],
        headers=XRW,
    )
    assert res.status_code == 422
    assert "不支持的图片格式" in res.json()["detail"]


def test_rejects_something_that_only_claims_to_be_an_image(vip_client):
    """一个 .png 名字套在非图片内容上，不能因为名字像图片就放行。"""
    res = vip_client.post(
        "/api/patterns",
        files=[("files", ("fake.png", io.BytesIO(b"not an image at all"), "image/png"))],
        headers=XRW,
    )
    assert res.status_code == 422
    assert "不支持的图片格式" in res.json()["detail"]


def test_a_jpeg_named_png_is_accepted_and_stored_as_jpg(vip_client, monkeypatch):
    """后缀说谎的图要收下，并按真实类型存。

    微信/QQ 转存出来的图纸经常是 JPEG 却叫 .png。之前这种图会一路带着错误的
    后缀和 content-type 送到 FastGPT，被它的内容嗅探打回（UploadFileTypeMismatch，
    500），表现成"多传几张就上传失败"。
    """
    _stub_ok(monkeypatch)
    res = vip_client.post(
        "/api/patterns",
        files=[("files", ("photo.png", io.BytesIO(JPEG), "image/png"))],
        headers=XRW,
    )
    assert res.status_code == 202
    job_id = res.json()["id"]
    _wait_for(vip_client, job_id, "done")

    with get_sessionmaker()() as session:
        rels = list(session.get(PatternJob, job_id).images)
    assert len(rels) == 1
    assert rels[0].endswith(".jpg"), rels[0]
    assert vip_client.get(f"/api/patterns/{job_id}/images/0").content == JPEG


def test_rejects_too_many_images(vip_client, monkeypatch):
    monkeypatch.setenv("PINDOU_UPLOAD_MAX_FILES", "2")
    from app.config import get_settings

    get_settings.cache_clear()
    res = vip_client.post("/api/patterns", files=_files(3), headers=XRW)
    assert res.status_code == 422
    assert "最多上传 2 张" in res.json()["detail"]


def test_rejects_an_oversized_image(vip_client, monkeypatch):
    monkeypatch.setenv("PINDOU_UPLOAD_MAX_BYTES", "10")
    from app.config import get_settings

    get_settings.cache_clear()
    res = vip_client.post("/api/patterns", files=_files(), headers=XRW)
    assert res.status_code == 422
    assert "不能超过" in res.json()["detail"]


def test_unconfigured_gateway_is_reported(auth_client, monkeypatch):
    _set_vip("tester", True)
    res = auth_client.post("/api/patterns", files=_files(), headers=XRW)
    assert res.status_code == 503


# ---------- 后台执行 ----------


def test_the_request_returns_immediately_and_the_work_happens_after(vip_client, monkeypatch):
    """接口不能等识别跑完——用户可能要等 20 分钟。"""
    released = []

    def slow(images, settings):
        time.sleep(0.15)
        released.append(True)
        return BatchResult(True, "A1, 1", "", "ok", "kimi-k3",
                           [ImageOutcome(i, n, "ok") for i, (n, _) in enumerate(images)])

    monkeypatch.setattr("app.routers.patterns.recognise", slow)

    t0 = time.time()
    res = vip_client.post("/api/patterns", files=_files(), headers=XRW)
    elapsed = time.time() - t0

    assert res.status_code == 202
    # 202 必须在识别完成之前就返回
    assert elapsed < 0.15, f"接口阻塞了 {elapsed:.2f}s"
    assert res.json()["status"] in ("pending", "running")

    _wait_for(vip_client, res.json()["id"], "done")
    assert released == [True]


def test_a_finished_job_carries_the_bead_list(vip_client, monkeypatch):
    _stub_ok(monkeypatch, bead_list="A1, 153\nC3, 20")
    job_id = vip_client.post("/api/patterns", files=_files(2), headers=XRW).json()["id"]
    job = _wait_for(vip_client, job_id, "done")
    # 这串东西可以原样粘进「按图扣减」
    assert job["bead_list"] == "A1, 153\nC3, 20"
    assert job["model"] == "kimi-k3"
    assert job["image_count"] == 2
    assert job["finished_at"] is not None


def test_a_failure_is_recorded_rather_than_lost(vip_client, monkeypatch):
    from app.fastgpt import FastGPTError

    def boom(images, settings):
        raise FastGPTError("所有模型都失败了")

    monkeypatch.setattr("app.routers.patterns.recognise", boom)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    job = _wait_for(vip_client, job_id, "failed")
    assert "失败" in job["error"]


def test_an_unexpected_error_does_not_leak_internals(vip_client, monkeypatch):
    def boom(images, settings):
        raise RuntimeError("Bearer sk-secret-should-not-appear")

    monkeypatch.setattr("app.routers.patterns.recognise", boom)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    job = _wait_for(vip_client, job_id, "failed")
    assert job["error"] == "识别失败"
    assert "sk-secret" not in job["error"]


# ---------- 红点 ----------


def test_a_finished_job_is_unseen_so_the_dot_shows(vip_client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")

    summary = vip_client.get("/api/patterns").json()
    assert summary["unseen"] == 1
    assert summary["running"] == 0


def test_marking_seen_clears_the_dot(vip_client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")

    vip_client.post(f"/api/patterns/{job_id}/seen", headers=XRW)
    assert vip_client.get("/api/patterns").json()["unseen"] == 0


def test_a_failed_job_does_not_light_the_dot(vip_client, monkeypatch):
    def boom(images, settings):
        raise RuntimeError("nope")

    monkeypatch.setattr("app.routers.patterns.recognise", boom)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "failed")
    # 红点是"有结果可看"，失败不算
    assert vip_client.get("/api/patterns").json()["unseen"] == 0


# ---------- 原图留存与隔离 ----------


def test_the_original_images_are_kept_for_later_viewing(vip_client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(2), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")

    res = vip_client.get(f"/api/patterns/{job_id}/images/0")
    assert res.status_code == 200
    assert res.content == PNG

    assert vip_client.get(f"/api/patterns/{job_id}/images/5").status_code == 404


def test_another_user_cannot_read_someone_elses_job(vip_client, client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")

    client.post("/api/auth/logout", headers=XRW)
    client.post(
        "/api/auth/register",
        json={"username": "intruder", "password": "password123"},
        headers=XRW,
    )
    _set_vip("intruder", True)

    # 404 而不是 403：不让别人靠状态码确认这个 id 存在
    assert client.get(f"/api/patterns/{job_id}").status_code == 404
    assert client.get(f"/api/patterns/{job_id}/images/0").status_code == 404
    assert client.get("/api/patterns").json()["jobs"] == []


# ---------- 存储辅助 ----------


def test_save_and_read_round_trip(tmp_path):
    rel = save_upload(str(tmp_path), 7, "a.PNG", PNG)
    assert rel.startswith("7/")
    assert read_upload(str(tmp_path), rel) == PNG


def test_an_odd_extension_falls_back_to_png(tmp_path):
    rel = save_upload(str(tmp_path), 1, "weird.exe", PNG)
    assert rel.endswith(".png")


def test_read_upload_refuses_to_escape_the_root(tmp_path):
    """rel 都是自己生成的，但路径穿越的代价太大，还是挡一道。"""
    with pytest.raises(ValueError, match="非法"):
        read_upload(str(tmp_path), "../../etc/passwd")


def test_jobs_are_listed_newest_first(vip_client, monkeypatch):
    _stub_ok(monkeypatch)
    ids = []
    for _ in range(3):
        ids.append(vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"])
    for job_id in ids:
        _wait_for(vip_client, job_id, "done")
    listed = [j["id"] for j in vip_client.get("/api/patterns").json()["jobs"]]
    assert listed == sorted(ids, reverse=True)


def test_the_job_row_survives_in_the_database(vip_client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")
    with get_sessionmaker()() as session:
        job = session.get(PatternJob, job_id)
        assert job is not None and job.status == "done" and len(job.images) == 1


# ---------- 删除记录 ----------


def test_deleting_a_job_removes_the_row_and_the_files(vip_client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(2), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")

    with get_sessionmaker()() as session:
        rels = list(session.get(PatternJob, job_id).images)
    from app.config import get_settings

    root = get_settings().upload_dir
    paths = [os.path.join(root, r) for r in rels]
    assert all(os.path.exists(p) for p in paths)

    assert vip_client.delete(f"/api/patterns/{job_id}", headers=XRW).status_code == 204

    # 记录和原图一起消失，不留孤儿文件占着卷
    assert vip_client.get(f"/api/patterns/{job_id}").status_code == 404
    assert not any(os.path.exists(p) for p in paths)


def test_deleting_is_idempotent_from_the_callers_point_of_view(vip_client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")
    assert vip_client.delete(f"/api/patterns/{job_id}", headers=XRW).status_code == 204
    # 第二次就是"不存在"，而不是 500
    assert vip_client.delete(f"/api/patterns/{job_id}", headers=XRW).status_code == 404


def test_a_missing_file_does_not_block_deleting_the_record(vip_client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")

    from app.config import get_settings

    with get_sessionmaker()() as session:
        rel = session.get(PatternJob, job_id).images[0]
    os.remove(os.path.join(get_settings().upload_dir, rel))

    # 文件早就没了不是错误——记录照删
    assert vip_client.delete(f"/api/patterns/{job_id}", headers=XRW).status_code == 204


def test_one_user_cannot_delete_anothers_job(vip_client, client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")

    client.post("/api/auth/logout", headers=XRW)
    client.post(
        "/api/auth/register",
        json={"username": "thief", "password": "password123"},
        headers=XRW,
    )
    _set_vip("thief", True)
    assert client.delete(f"/api/patterns/{job_id}", headers=XRW).status_code == 404


def test_a_normal_account_cannot_delete(auth_client):
    assert auth_client.delete("/api/patterns/1", headers=XRW).status_code == 403


# ---------- 图里没有色号统计区域 ----------


def test_a_non_extraction_is_flagged_rather_than_passed_off_as_a_result(vip_client, monkeypatch):
    """插件说"这不是可提取的图"时，不能当成正常结果。"""
    _stub_ok(
        monkeypatch,
        bead_list="",
        is_extraction=False,
    )
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    job = _wait_for(vip_client, job_id, "done")

    assert job["extracted"] is False
    assert job["bead_list"] == ""
    # nl_response 就是解释原因的那句话，要留给用户看
    assert job["note"]


def test_a_non_extraction_does_not_light_the_red_dot(vip_client, monkeypatch):
    _stub_ok(monkeypatch, bead_list="", is_extraction=False)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")
    # 「这张图里没有色号表」不值得打断用户
    assert vip_client.get("/api/patterns").json()["unseen"] == 0


def test_a_real_extraction_still_lights_it(vip_client, monkeypatch):
    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    job = _wait_for(vip_client, job_id, "done")
    assert job["extracted"] is True
    assert vip_client.get("/api/patterns").json()["unseen"] == 1


def test_the_extracted_column_is_added_to_a_database_that_predates_it(vip_client, monkeypatch):
    """线上已经有 pattern_jobs 表了，create_all 不会给它补列。"""
    from app.db import _add_missing_columns, get_engine

    _stub_ok(monkeypatch)
    job_id = vip_client.post("/api/patterns", files=_files(), headers=XRW).json()["id"]
    _wait_for(vip_client, job_id, "done")

    engine = get_engine()
    with engine.begin() as conn:
        conn.exec_driver_sql("ALTER TABLE pattern_jobs DROP COLUMN extracted")
    _add_missing_columns(engine)
    with engine.begin() as conn:
        cols = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(pattern_jobs)").fetchall()}
        assert "extracted" in cols
        # 老记录默认算"抽到了"——它们本来就是正常结果
        assert conn.exec_driver_sql("SELECT extracted FROM pattern_jobs").scalar() == 1
    assert vip_client.get(f"/api/patterns/{job_id}").json()["extracted"] is True


# ---------- 逐图隔离与分批 ----------


def test_a_bad_image_does_not_take_the_good_ones_down(vip_client, monkeypatch):
    """一张格式不对，其余照常识别。

    以前是整批 422：用户为一张废图重传另外十九张。现在废的那张单独记下来，
    能认的都认了。
    """
    _stub_ok(monkeypatch, bead_list="A1, 7")
    res = vip_client.post(
        "/api/patterns",
        files=[
            ("files", ("good0.png", io.BytesIO(PNG), "image/png")),
            ("files", ("junk.png", io.BytesIO(b"definitely not an image"), "image/png")),
            ("files", ("good1.png", io.BytesIO(PNG), "image/png")),
        ],
        headers=XRW,
    )
    assert res.status_code == 202
    job = _wait_for(vip_client, res.json()["id"], "done")

    assert job["bead_list"] == "A1, 7"          # 好的两张照常出结果
    items = {it["index"]: it for it in job["items"]}
    assert len(items) == 3
    assert items[1]["status"] == "failed"
    assert "不支持的图片格式" in items[1]["error"]
    assert items[0]["status"] == "ok" and items[2]["status"] == "ok"
    # 部分失败要说清楚，但不能把整个任务标成 failed
    assert job["status"] == "done"
    assert "1/3" in job["error"]


def test_an_image_the_model_cannot_read_is_named(vip_client, monkeypatch):
    """识别不出的那张要指名道姓，而不是"这次不行"。"""
    _stub_ok(monkeypatch, fail={1})
    job_id = vip_client.post("/api/patterns", files=_files(3), headers=XRW).json()["id"]
    job = _wait_for(vip_client, job_id, "done")

    items = {it["index"]: it for it in job["items"]}
    assert items[1]["status"] == "failed"
    assert items[1]["filename"] == "p1.png"
    assert items[0]["status"] == "ok" and items[2]["status"] == "ok"


def test_twenty_images_are_allowed(vip_client, monkeypatch):
    """分批送模型之后，单批规模不随上传量增长，所以上限可以放宽到 20。"""
    _stub_ok(monkeypatch)
    res = vip_client.post("/api/patterns", files=_files(20), headers=XRW)
    assert res.status_code == 202
    assert _wait_for(vip_client, res.json()["id"], "done")["image_count"] == 20


def test_every_image_rejected_is_still_an_error(vip_client):
    """一张能用的都没有，那就是彻底失败，别建个空任务糊弄用户。"""
    res = vip_client.post(
        "/api/patterns",
        files=[
            ("files", ("a.png", io.BytesIO(b"junk"), "image/png")),
            ("files", ("b.png", io.BytesIO(b"junk"), "image/png")),
        ],
        headers=XRW,
    )
    assert res.status_code == 422
    assert "没有一张" in res.json()["detail"]


# ---------- 合并与排序 ----------


def test_the_merged_result_is_in_code_order_not_by_quantity():
    """清单和明细表都按色号排，不按数量。

    用户拿这张表对着一盒按系列摆好的豆子取货，按数量排就得一行行找。
    """
    from app.fastgpt import PatternResult, _merge

    r = lambda t: PatternResult(True, t, "", "", "kimi-k3")  # noqa: E731
    extracted, bead_list, md_table, note = _merge(
        [([0], r("C3, 5\nA10, 1")), ([1], r("A2, 7\nA10, 2"))], 2
    )
    assert extracted
    assert bead_list == "A2, 7\nA10, 3\nC3, 5"
    rows = [line.split("|")[1].strip() for line in md_table.splitlines()[2:]]
    assert rows == ["A2", "A10", "C3", "色号数量", "总豆数"]


def test_the_detail_table_has_one_column_per_image():
    """每次请求只送一张图，所以每一列的归属是确定的，可以自己重建。"""
    from app.fastgpt import PatternResult, _merge

    r = lambda t: PatternResult(True, t, "", "", "kimi-k3")  # noqa: E731
    _, _, md_table, note = _merge([([0], r("A1, 5")), ([2], r("A1, 2\nB1, 9"))], 3)
    lines = md_table.splitlines()
    assert lines[0] == "| 色号 | 图片1 | 图片2 | 图片3 | 合计 |"
    # 第 2 张没有结果（认不出来），列还在，只是空的
    assert lines[2] == "| A1 | 5 |  | 2 | 7 |"
    assert lines[3] == "| B1 |  |  | 9 | 9 |"
    assert lines[-2] == "| 色号数量 | 1 | 0 | 2 | 2 |"
    assert lines[-1] == "| 总豆数 | 5 | 0 | 11 | 16 |"
    # 那句话按合并后的总数写，不是把模型每次的"已从 1 张图片中…"拼起来
    assert note == "已从 2 张图片中共提取到 2 种色号，合计 16 颗拼豆。"
