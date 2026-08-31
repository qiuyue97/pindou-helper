# --- stage 1: build the SPA -------------------------------------------------
FROM node:20-slim AS web
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY shared/ ./shared/
COPY frontend/ ./frontend/
RUN cd frontend && npm run gen:catalog && npm run build

# --- stage 2: runtime -------------------------------------------------------
FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install --no-cache-dir .

COPY --from=web /build/frontend/dist /app/static

ENV PINDOU_DB_URL=sqlite:////data/pindou.db \
    PINDOU_STATIC_DIR=/app/static \
    PINDOU_COOKIE_SECURE=0
VOLUME ["/data"]
EXPOSE 8000

CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
