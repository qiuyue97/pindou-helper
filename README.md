# 拼豆助手 (pindou-helper)

Per-user Perler/Mard bead inventory manager + rigorous colour matcher.
Replaces `11_unlocked.xlsm`. See `docs/superpowers/specs/2026-08-31-pindou-helper-design.md`.

## Frontend (colour engine)

```
cd frontend && npm install
npm run gen:catalog   # regenerate base catalogue from shared/mard-291.txt
npm test              # vitest
npm run typecheck     # tsc --noEmit
```

## Backend (API)

```
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"     # .venv/bin/python on macOS/Linux
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m uvicorn "app.main:create_app" --factory --reload --port 8000
```

Config via `PINDOU_`-prefixed env vars — see `backend/.env.example`.

## Running both (dev)

Two terminals:

```
# 1) API on :8000
cd backend && .venv/Scripts/python -m uvicorn "app.main:create_app" --factory --reload --port 8000

# 2) UI on :5173 (proxies /api to :8000)
cd frontend && npm run dev
```

Open http://localhost:5173.

## Features

- **取色与配色匹配** — screen eyedropper (Chrome/Edge), tap a point on a photo with a
  magnifier loupe, or type a hex / RGB. Matching uses CIEDE2000 normalised by each
  colour's local spacing in the palette, and reports one recommendation with a
  plain-language confidence. Toggle between the 221 A–M codes and all 291.
- **颜色空间图** — the sample plus its ~8–12 real neighbours on an a*–b* plane, an L*
  lightness strip, and an orbitable 3D CIELAB view. Never all 291 points.
- **我的色卡** — override any standard colour's HEX or add your own codes; per-account.
- **库存与历史** — batch add/deduct, demand check, stockout list, and an operations
  timeline where any step can be undone or edited (later steps replay automatically).

## Docker (single container)

```
echo "PINDOU_JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose up --build
```

Serves the API and the built SPA on http://localhost:8000 from one origin.
SQLite lives in the `pindou-data` volume at `/data/pindou.db`.
