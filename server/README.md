# ZeroLag License Server

This is the first production-server MVP for ZeroLag subscriptions.

It provides:

- `POST /v1/licenses/activate`
- `POST /v1/licenses/validate`
- `POST /v1/orders/create`
- `GET /v1/orders/:orderId`
- `POST /v1/payments/webhook`
- `POST /v1/admin/activation-codes`
- `POST /v1/admin/orders/complete`
- `POST /v1/admin/orders/refund`
- `GET /v1/admin/subscriptions`
- `GET /v1/admin/subscriptions/:subscriptionId`
- `POST /v1/admin/subscriptions/revoke`
- `GET /v1/admin/audit-events`
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
npm run server:admin -- refund-order ord_xxx manual_refund_id
npm run server:admin -- send-webhook ord_xxx manual_trade_id
npm run server:admin -- send-refund-webhook ord_xxx manual_refund_id
npm run server:admin -- subscriptions
npm run server:admin -- subscriptions active
npm run server:admin -- subscription sub_xxx
npm run server:admin -- revoke-subscription sub_xxx support_revoke
npm run server:admin -- audit-events 50
npm run server:admin -- audit-events 50 payment.succeeded
npm run server:admin -- summary
```

The admin API requires the `X-ZeroLag-Admin-Secret` header. In production this must be a strong secret stored outside the repo.

Signed payment webhooks require the `X-ZeroLag-Signature` header. The signature format is:

```text
sha256=<hmac_sha256_of_raw_json_body>
```

Set `ZEROLAG_PAYMENT_WEBHOOK_SECRET` to a strong value before connecting a real payment provider.

## Order Flow MVP

The server now supports a provider-neutral order flow:

1. Client or website calls `POST /v1/orders/create`.
2. Payment provider completes payment.
3. Payment provider calls `POST /v1/payments/webhook` with a verified `payment.succeeded` event.
4. The paid order receives a one-time activation code.
5. Desktop app activates membership with that code.
6. If the device already has the same active plan, the new code extends the existing subscription.
7. If the provider later sends `payment.refunded`, the related code and active membership are revoked.

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
- Use a strong `ZEROLAG_SERVER_SECRET`.
- Use a strong `ZEROLAG_ADMIN_SECRET`.
- Use a strong `ZEROLAG_PAYMENT_WEBHOOK_SECRET`.
- Move state from JSON to a real database.
- Replace the manual payment placeholder with WeChat Pay, Alipay, Stripe, or another provider that calls the signed webhook.

## Test

```powershell
npm run server:test
```
