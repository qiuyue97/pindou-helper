# syntax=docker/dockerfile:1

# --- stage 1: build the SPA -------------------------------------------------
FROM node:20-slim AS web
WORKDIR /build

# Dependencies first so edits to source don't bust the npm cache layer.
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

COPY shared/ ./shared/
COPY frontend/ ./frontend/

# Regenerate the 291-colour catalogue from shared/mard-291.txt, then build.
# gen:catalog also asserts the per-series counts, so a corrupted source file
# fails the build here rather than at runtime.
RUN cd frontend && npm run gen:catalog && npm run build


# --- stage 2: runtime -------------------------------------------------------
FROM python:3.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install --no-cache-dir .

# The catalogue is package DATA, not code. Import it from a different working
# directory so this proves the installed package is self-contained rather than
# accidentally picking up ./app from the current directory.
RUN cd / && python -c "from app.catalog import BASE; assert len(BASE) == 291, len(BASE); print('catalogue ok:', len(BASE))"

COPY --from=web /build/frontend/dist /app/static

# Run unprivileged. /data is created here so the named volume inherits this
# ownership the first time Docker populates it.
RUN useradd --system --create-home --uid 10001 pindou \
    && mkdir -p /data \
    && chown -R pindou:pindou /data /app
USER pindou

ENV PINDOU_DB_URL=sqlite:////data/pindou.db \
    PINDOU_STATIC_DIR=/app/static \
    PINDOU_COOKIE_SECURE=0

VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
