# 刻意不写 `# syntax=docker/dockerfile:1`：那会让 BuildKit 去 Docker Hub 拉
# 前端镜像，在访问不到 Hub 的环境（如国内 NAS）直接构建失败。本文件没有用到
# 任何需要新 syntax 的特性。
#
# 所有镜像源都是 ARG，默认走国内源；在墙外构建时用
#   docker compose build --build-arg REGISTRY=docker.io \
#       --build-arg NPM_REGISTRY=https://registry.npmjs.org \
#       --build-arg PIP_INDEX=https://pypi.org/simple \
#       --build-arg APT_MIRROR=deb.debian.org
# 覆盖回官方源即可。
ARG REGISTRY=docker.m.daocloud.io
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn


# --- stage 1: build the SPA -------------------------------------------------
FROM ${REGISTRY}/library/node:20-slim AS web
ARG NPM_REGISTRY
# npm ≥9 会把 lockfile 里 registry.npmjs.org 的 resolved 地址改写到这个源
# （replace-registry-host 默认为 npmjs），所以 npm ci 依然可用。
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY} \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
WORKDIR /build

# 依赖单独一层，改源码不会让 npm 缓存失效
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

COPY shared/ ./shared/
COPY frontend/ ./frontend/

# 从 shared/mard-291.txt 重新生成色卡再打包。gen:catalog 会断言总数和
# 每个系列的数量，源数据损坏时在这里就失败，不会带到运行时。
RUN cd frontend && npm run gen:catalog && npm run build


# --- stage 2: runtime -------------------------------------------------------
FROM ${REGISTRY}/library/python:3.12-slim AS runtime
ARG PIP_INDEX
ARG APT_MIRROR

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_INDEX_URL=${PIP_INDEX}

WORKDIR /app

# bookworm 用 deb822 格式的 debian.sources，老镜像用 sources.list，两个都处理。
# 装 tzdata 是为了让 compose 里的 TZ 真正生效——slim 镜像不自带时区数据库。
RUN set -eux; \
    for f in /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list; do \
        [ -f "$f" ] && sed -i \
            -e "s|deb.debian.org|${APT_MIRROR}|g" \
            -e "s|security.debian.org|${APT_MIRROR}|g" "$f" || true; \
    done; \
    apt-get update; \
    apt-get install -y --no-install-recommends tzdata; \
    rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install .

# 色卡是包数据不是代码。故意换到 / 目录 import，证明安装后的包是自包含的，
# 而不是碰巧命中了当前目录下的 ./app。打包配置退化时构建会在这里失败。
RUN cd / && python -c "from app.catalog import BASE; assert len(BASE) == 291, len(BASE); print('catalogue ok:', len(BASE))"

COPY --from=web /build/frontend/dist /app/static

# 非 root 运行。/data 在这里建好并授权，命名卷首次创建时会继承这个属主。
RUN useradd --system --create-home --uid 10001 pindou \
    && mkdir -p /data \
    && chown -R pindou:pindou /data /app
USER pindou

ENV PINDOU_DB_URL=sqlite:////data/pindou.db \
    PINDOU_STATIC_DIR=/app/static

VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status == 200 else 1)"

# --proxy-headers 让 uvicorn 认 X-Forwarded-*，反代终止 TLS 时才能拿到
# 正确的客户端 IP 和协议。
CMD ["uvicorn", "app.main:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
