# 拼豆助手 (pindou-helper)

Per-user Perler/Mard bead inventory manager + rigorous colour matcher.
Replaces `11_unlocked.xlsm`. See `docs/superpowers/specs/2026-08-31-pindou-helper-design.md`.

## Dev

```
cd frontend && npm install
npm run gen:catalog   # regenerate base catalogue from shared/mard-291.txt
npm test              # vitest
npm run typecheck     # tsc --noEmit
```

Backend and UI arrive in later plans.
