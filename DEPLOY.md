# Deploying the CAD ordering prototype to Render

- `render.yaml` (Blueprint): Node web service, **free plan**, `npm ci --omit=dev` then `npm start`, health check `/api/config`.
- The server listens on `process.env.PORT` (Render sets it); defaults to 3000 locally.
- Environment: `ADMIN_KEY` (default `cad-admin`), `BASE_URL` (used in payment links inside outbox emails; set it to the
  Render URL), optional `STRIPE_SECRET_KEY` (leave unset: payments stay mock).
- **Storage is ephemeral on Render's free plan.** Orders (`data/orders.json`), the schedule CSV (`data/schedule-2026.csv`),
  emails (`outbox/`) and photo uploads (`uploads/`) live on the instance's local disk and reset on every restart, redeploy or
  idle spin-down (~15 min without traffic; the next visit takes ~1 min to wake). Fine for a test link. For persistence
  later: a paid instance + persistent disk, with `STORAGE_DIR` pointed at the mount path.
- Safety: mock payments only; emails are written to `outbox/` and never sent; nothing ever writes to the real CAD Google Sheet.
- Admin: `/admin?key=cad-admin`.

Steps: push this folder to a GitHub repo → Render → New → Blueprint → pick the repo → Apply.
