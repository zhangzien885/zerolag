# ZeroLag License Server

This is the first production-server MVP for ZeroLag subscriptions.

It provides:

- `POST /v1/licenses/activate`
- `POST /v1/licenses/validate`
- `POST /v1/orders/create`
- `GET /v1/orders/:orderId`
- `POST /v1/admin/activation-codes`
- `POST /v1/admin/orders/complete`
- `GET /v1/admin/summary`
- `GET /v1/updates/manifest`
- local activation-code creation for early testing
- device binding and token rotation

## Start Locally

```powershell
npm run server:start
```

Default URL:

```text
http://127.0.0.1:8787
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
npm run server:admin -- summary
```

The admin API requires the `X-ZeroLag-Admin-Secret` header. In production this must be a strong secret stored outside the repo.

## Order Flow MVP

The server now supports a provider-neutral order flow:

1. Client or website calls `POST /v1/orders/create`.
2. Payment provider completes payment.
3. Backend calls `POST /v1/admin/orders/complete`.
4. The paid order receives a one-time activation code.
5. Desktop app activates membership with that code.

The MVP uses manual completion so the product can be tested before choosing WeChat Pay, Alipay, or another payment provider.

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
- Use a strong `ZEROLAG_SERVER_SECRET`.
- Use a strong `ZEROLAG_ADMIN_SECRET`.
- Move state from JSON to a real database.
- Add payment webhooks that create subscriptions or activation codes.

## Test

```powershell
npm run server:test
```
