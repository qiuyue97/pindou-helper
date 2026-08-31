import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db import init_db

log = logging.getLogger("pindou")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.jwt_secret == "dev-insecure-change-me":
        log.warning("PINDOU_JWT_SECRET is the insecure default — set it in production")

    init_db()

    app = FastAPI(title="pindou-helper")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next):
        if request.method not in SAFE_METHODS and request.url.path.startswith("/api/"):
            if request.headers.get("x-requested-with") != "pindou":
                return JSONResponse({"detail": "missing X-Requested-With"}, status_code=403)
        return await call_next(request)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    from app.routers import auth, colors, inventory, operations

    for r in (auth.router, inventory.router, operations.router, colors.router):
        app.include_router(r, prefix="/api")

    if settings.static_dir:
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="spa")

    return app
