from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Never use in production — but keep it >= 32 bytes so HS256 signing does not
# trip the RFC 7518 §3.2 minimum-key-length warning during local development.
DEV_INSECURE_SECRET = "dev-insecure-change-me-before-deploying"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PINDOU_", env_file=".env", extra="ignore")

    db_url: str = "sqlite:///./pindou.db"
    jwt_secret: str = DEV_INSECURE_SECRET
    jwt_days: int = 30
    cookie_secure: bool = False
    cors_origins: str = "http://localhost:5173"
    static_dir: str = ""

    # --- 智能管控用的 LLM（OpenAI 兼容网关）---
    llm_base_url: str = ""
    llm_api_key: str = ""
    # 按顺序尝试，前一个失败就退到下一个。
    llm_models: str = (
        "Kimi-K3-256K,GLM-5.2,dashscope/qwen3.8-max,"
        "gemini/gemma-4-31b-it,azure_ai/gpt-5.6-terra"
    )
    llm_timeout: float = 60.0

    # --- 拼豆图纸识别（VIP）：FastGPT 上的插件 ---
    fastgpt_base_url: str = ""
    fastgpt_api_key: str = ""
    fastgpt_app_id: str = ""
    # 按顺序尝试。工作流的 model_name 入参已接到 AI 节点上，这里改能真的换模型。
    fastgpt_models: str = "kimi-k3,gpt-5.6-terra"
    # 识别可能很久，而且整个调用在后台线程里，卡住也不影响前台。
    fastgpt_timeout: float = 20 * 60
    #: 用户原图的存放目录。要落在持久卷上，否则重建容器就没了。
    upload_dir: str = "/data/uploads"
    #: 单张图上限，同时也是 FastGPT 那边能接受的量级。
    upload_max_bytes: int = 12 * 1024 * 1024
    #: 一次能传多少张。分批送模型之后单批规模不再随上传量增长，所以可以放宽。
    upload_max_files: int = 20
    #: 每次请求塞几张图。一张一张送：喂多了模型会把不同图纸的色号串在一起，而且
    #: 每张单独一个请求，成败天然落在具体某张上，不必事后拆批归因。
    fastgpt_images_per_request: int = 1
    #: 同时在跑的请求数
    fastgpt_concurrency: int = 4
    #: 单张压缩预算。默认按"一次请求内所有内联图片之和"的上限除以每批张数自动
    #: 算——两者必须同步，分开配迟早漂掉。设成正数可以覆盖。
    inline_budget_override: int = 0
    #: 名字里带这些片段的模型走"图片转 base64 内联"那条链路，受 inline_budget 约束。
    #: 压不进预算的图会跳过它们，直接找吃 URL 的模型。
    inline_limited: str = "kimi"

    @property
    def fastgpt_model_list(self) -> list[str]:
        return [m.strip() for m in self.fastgpt_models.split(",") if m.strip()]

    @property
    def inline_budget(self) -> int:
        if self.inline_budget_override > 0:
            return self.inline_budget_override
        from app.imaging import INLINE_LIMIT

        # 留 5% 余量：请求里除了图片还有 JSON 结构和别的 content part
        return int(INLINE_LIMIT * 0.95) // max(1, self.fastgpt_images_per_request)

    @property
    def inline_limited_list(self) -> list[str]:
        return [m.strip().lower() for m in self.inline_limited.split(",") if m.strip()]

    @property
    def fastgpt_configured(self) -> bool:
        return bool(self.fastgpt_base_url and self.fastgpt_api_key and self.fastgpt_app_id)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_model_list(self) -> list[str]:
        return [m.strip() for m in self.llm_models.split(",") if m.strip()]

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_base_url and self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
