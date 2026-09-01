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
    upload_max_files: int = 10

    @property
    def fastgpt_model_list(self) -> list[str]:
        return [m.strip() for m in self.fastgpt_models.split(",") if m.strip()]

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
