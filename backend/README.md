# pindou-helper backend

FastAPI + SQLite. See `../docs/superpowers/specs/2026-08-31-pindou-helper-design.md`.

## Dev

```
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"     # .venv/bin/python on macOS/Linux
.venv/Scripts/python -m pytest -q                    # run tests
.venv/Scripts/python -m uvicorn "app.main:create_app" --factory --reload --port 8000
```

Config: copy `.env.example` to `.env` and edit. All vars are `PINDOU_`-prefixed.
To serve the built frontend from the API origin, set `PINDOU_STATIC_DIR=../frontend/dist`
(unknown non-`/api` routes then fall back to `index.html` for client-side routing).
