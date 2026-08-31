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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
