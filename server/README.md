# ZeroLag License Server

This is the first production-server MVP for ZeroLag subscriptions.

It provides:

- `POST /v1/licenses/activate`
- `POST /v1/licenses/validate`
- `POST /v1/orders/create`
- `GET /v1/orders/:orderId`
- `POST /v1/payments/webhook`
- `POST /v1/website/events`
- `POST /v1/admin/activation-codes`
- `POST /v1/admin/orders/complete`
- `POST /v1/admin/orders/refund`
- `GET /v1/admin/subscriptions`
- `GET /v1/admin/subscriptions/:subscriptionId`
- `POST /v1/admin/subscriptions/revoke`
- `GET /v1/admin/audit-events`
- `GET /v1/admin/summary`
- `GET /v1/admin/export`
- `GET /v1/updates/manifest`
- local activation-code creation for early testing
- device binding and token rotation
- in-memory rate limiting for public, payment, and admin endpoints
- atomic state writes, rolling state backups, and admin state export

## Start Locally

```powershell
npm run server:start
```

Default URL:

```text
http://127.0.0.1:8787
```

## Smoke Test

Before opening a server to real users, run a local smoke test:

```powershell
npm run server:smoke
```

The smoke test loads the same private env file as the server, starts a temporary local API instance, checks `/v1/health`, and verifies `/v1/admin/readiness` with the configured admin secret. By default it uses isolated temporary state so it does not mutate real membership data.

If `ZEROLAG_STATE_STORE=sqlite` is configured, the default smoke test uses a temporary SQLite file and prints `Mode: isolated-sqlite`. It still avoids the configured live SQLite path.

To intentionally test against the configured state path:

```powershell
npm run server:smoke -- --live-state
```

## Private Environment File

Generate strong local secrets for private testing or deployment preparation:

```powershell
npm run server:secrets -- --write
```

Server commands automatically load `.secrets/server.env` when it exists, including `server:start`, `server:create-code`, `server:admin`, and `server:check`. Existing system environment variables stay higher priority, so a host provider or Windows service can still override file values.

To test with a different env file:

```powershell
$env:ZEROLAG_ENV_FILE="D:\zerolag-private\server.env"
npm run server:check:strict
```

## Create A Test Code

```powershell
npm run server:create-code -- ZL-PRO-TEST-001 30 1
```

Arguments:

- `ZL-PRO-TEST-001`: activation code
- `30`: valid days
- `1`: max device activations

The server stores local state in `server/data/server-state.json`. This file is intentionally ignored by Git.

## Admin API

Start the server, then create a code through the admin API:

```powershell
$env:ZEROLAG_ADMIN_SECRET="change-this-before-production"
npm run server:admin -- create-code ZL-PRO-TEST-002 30 1
npm run server:admin -- orders
npm run server:admin -- complete-latest manual_trade_id
npm run server:admin -- complete-order ord_xxx manual_trade_id
npm run server:admin -- refund-order ord_xxx manual_refund_id
npm run server:admin -- send-webhook ord_xxx manual_trade_id
npm run server:admin -- send-refund-webhook ord_xxx manual_refund_id
npm run server:admin -- subscriptions
npm run server:admin -- subscriptions active
npm run server:admin -- subscription sub_xxx
npm run server:admin -- revoke-subscription sub_xxx support_revoke
npm run server:admin -- audit-events 50
npm run server:admin -- audit-events 50 payment.succeeded
npm run server:admin -- ops-summary
npm run server:admin -- ops-csv .\zerolag-operations.csv
npm run server:admin -- analytics
npm run server:admin -- analytics-funnel
npm run server:admin -- analytics-csv .\website-analytics.csv
npm run server:admin -- analytics-report .\website-analytics.html
npm run server:admin -- export-state .\server-state-export.json
npm run server:admin -- summary
```

The admin API requires the `X-ZeroLag-Admin-Secret` header. In production this must be a strong secret stored outside the repo.

`ops-summary` and `ops-csv` are private operator tools for reviewing paid orders, refunds, active memberships, renewals, and upcoming expirations. The CSV export intentionally omits activation codes and tokens.

Signed payment webhooks require the `X-ZeroLag-Signature` header. The signature format is:

```text
sha256=<hmac_sha256_of_raw_json_body>
```

Set `ZEROLAG_PAYMENT_WEBHOOK_SECRET` to a strong value before connecting a real payment provider.

Payment provider settings:

```powershell
$env:ZEROLAG_PAYMENT_PROVIDER="wechat_pay"
$env:ZEROLAG_PAYMENT_ALLOWED_PROVIDERS="wechat_pay,alipay"
$env:ZEROLAG_PAYMENT_URL_TEMPLATE="https://pay.example/checkout/{orderId}?amount={amountCents}&currency={currency}"
$env:ZEROLAG_PAYMENT_MESSAGE="Open the secure checkout page to finish payment."
```

`ZEROLAG_PAYMENT_PROVIDER` controls the provider returned from order creation. `ZEROLAG_PAYMENT_ALLOWED_PROVIDERS` controls which signed webhook providers can complete or refund orders. Keep `manual` for local testing only; production should remove test providers from the allowlist.

## Rate Limiting

The server applies lightweight in-memory rate limits before sensitive handlers run. Defaults are tuned for the MVP:

- `POST /v1/orders/create`: 30 requests per minute per client IP
- `POST /v1/website/events`: 240 requests per minute per client IP
- `POST /v1/licenses/activate`: 20 requests per minute per client IP
- `POST /v1/licenses/validate`: 240 requests per minute per client IP
- `POST /v1/payments/webhook`: 120 requests per minute per client IP
- admin endpoints: 120 requests per minute per client IP

Optional environment variables:

```powershell
$env:ZEROLAG_RATE_LIMIT_MAX="120"
$env:ZEROLAG_RATE_LIMIT_WINDOW_MS="60000"
$env:ZEROLAG_RATE_LIMIT_DISABLED="0"
$env:ZEROLAG_TRUST_PROXY="0"
```

Keep rate limiting enabled in production, and add edge protection through the hosting provider or reverse proxy before public release. Set `ZEROLAG_TRUST_PROXY=1` only when your reverse proxy overwrites client IP headers safely.

## Website Analytics

Set the public website `analyticsUrl` to `https://your-api.example/v1/website/events` after deploying this server behind HTTPS. The endpoint supports cross-origin website POSTs and `OPTIONS` preflight responses.

The endpoint accepts only known website CTA event names and stores aggregate counters by event, version, channel, status, day, and per-day event breakdown. Version, channel, and status counters are capped to 64 keys each, and daily counters keep the latest 90 days. It does not store client IPs, browser user agents, activation codes, tokens, order IDs, or raw event payloads.

To view aggregate website CTA counts:

```powershell
npm run server:admin -- analytics
npm run server:admin -- analytics-funnel
npm run server:admin -- analytics-csv .\website-analytics.csv
npm run server:admin -- analytics-report .\website-analytics.html
```

The funnel command includes overall conversion plus the latest day's event breakdown. The CSV export includes `day_event` rows such as `2026-06-28:download_click` for private trend review.
The HTML report is a local private dashboard for quick visual review and should not be uploaded to the public website.

## State Safety

The JSON-state MVP now writes state through a temporary file and atomic rename. Before overwriting an existing state file, the server keeps a rolling backup under `server/data/backups` by default. If the main state JSON is corrupted, `loadState` attempts to recover from the newest readable backup.

The server also accepts a custom synchronous `stateStore` option for future database migration work. See `docs/state-storage-contract.md` for the current contract.

Optional SQLite prototype storage:

```powershell
$env:ZEROLAG_STATE_STORE="sqlite"
$env:ZEROLAG_SQLITE_STATE_PATH="D:\zerolag-data\server-state.sqlite"
npm run server:start
```

SQLite mode is intended for wider paid testing before a full PostgreSQL-style async storage migration. The JSON file store remains the default.

`npm run server:check:strict` verifies the configured SQLite state file can be read, contains a server state document, and has a readable recent SQLite backup before wider paid testing.

To migrate an existing JSON state file into SQLite:

```powershell
npm run server:migrate-sqlite -- --input D:\zerolag-data\server-state.json --output D:\zerolag-data\server-state.sqlite
```

To export and verify a private SQLite state backup:

```powershell
npm run server:backup-sqlite -- --input D:\zerolag-data\server-state.sqlite --output D:\zerolag-backups\server-state-backup.sqlite
npm run server:check-sqlite-backups -- --dir D:\zerolag-backups --max-age-hours 24
```

To restore a private SQLite backup after stopping the server:

```powershell
npm run server:restore-sqlite -- --input D:\zerolag-backups\server-state-backup.sqlite --output D:\zerolag-data\server-state.sqlite --force
```

Optional environment variables:

```powershell
$env:ZEROLAG_SERVER_BACKUP_DIR="D:\zerolag-backups"
$env:ZEROLAG_SQLITE_BACKUP_DIR="D:\zerolag-sqlite-backups"
$env:ZEROLAG_SERVER_BACKUP_RETENTION="25"
$env:ZEROLAG_SERVER_BACKUP_DISABLED="0"
```

Admins can export the current state for migration or manual backup:

```powershell
npm run server:admin -- export-state .\server-state-export.json
```

The export contains sensitive operational state and should be stored privately.

## Order Flow MVP

The server now supports a provider-neutral order flow:

1. Client or website calls `POST /v1/orders/create`.
2. The server returns the configured payment provider and payment URL.
3. Payment provider calls `POST /v1/payments/webhook` with a verified `payment.succeeded` event.
4. The paid order receives a one-time activation code.
5. Desktop app activates membership with that code.
6. If the device already has the same active plan, the new code extends the existing subscription.
7. If the provider later sends `payment.refunded`, the related code and active membership are revoked.

Signed payment webhooks from providers outside `ZEROLAG_PAYMENT_ALLOWED_PROVIDERS` are rejected before they can change order state.

The admin completion endpoint is kept for private testing and manual support fixes, but the signed webhook is the main production integration seam.

## Connect The Desktop App Locally

Fast path:

```powershell
npm run dev:server-app
```

This starts the local server, creates `ZL-PRO-LOCAL-TEST`, and opens the desktop app with server-backed membership enabled through environment variables.

Manual path:

Set `assets/app-config.json`:

```json
{
  "releaseMode": "development",
  "apiBaseUrl": "http://127.0.0.1:8787",
  "allowLocalDemoLicense": true
}
```

For a paid release:

- Use HTTPS.
- Set `releaseMode` to `production`.
- Set `allowLocalDemoLicense` to `false`.
- Configure real HTTPS `websiteUrl`, `purchaseUrl`, `analyticsUrl`, `supportUrl`, `apiBaseUrl`, and `updateManifestUrl` values.
- Use a strong `ZEROLAG_SERVER_SECRET`.
- Use a strong `ZEROLAG_ADMIN_SECRET`.
- Use a strong `ZEROLAG_PAYMENT_WEBHOOK_SECRET`.
- Configure `ZEROLAG_PAYMENT_PROVIDER`, `ZEROLAG_PAYMENT_ALLOWED_PROVIDERS`, and `ZEROLAG_PAYMENT_URL_TEMPLATE` for the real payment provider.
- Keep rate limiting enabled and add reverse-proxy protection for public traffic.
- Keep server state backups enabled until JSON state is replaced by a real database.
- Move state from JSON to a real database.
- Replace the manual payment placeholder with WeChat Pay, Alipay, Stripe, or another provider that calls the signed webhook.

## Test

```powershell
npm run server:test
```
