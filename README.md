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

The React UI + packaging arrive in Plan 3.
