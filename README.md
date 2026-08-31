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

Colour matching, the colour-space visualisation, my-colours and Docker packaging arrive in Plan 4.
