# ZeroLag Server API Contract

This is the first production client contract for account and subscription validation.

The runnable MVP server lives in `server/`. It is suitable for local integration testing and early private trials. Before a paid public release, move its JSON state into a real database, put it behind HTTPS, and connect payment webhooks.

Admin endpoints require the `X-ZeroLag-Admin-Secret` header.

Payment webhooks require the `X-ZeroLag-Signature` header. The signature must be calculated from the exact raw JSON request body:

```text
sha256=<hmac_sha256(raw_body, ZEROLAG_PAYMENT_WEBHOOK_SECRET)>
```

Sensitive public, payment, and admin endpoints are rate limited per client IP. A blocked request returns:

```json
{
  "message": "Too many requests. Please try again later."
}
```

Production deployments should keep app-level rate limiting enabled and add reverse-proxy or hosting-provider protection at the edge.
Only enable trusted proxy IP headers when the reverse proxy overwrites them safely.

The JSON-state MVP uses atomic writes and rolling local backups before each overwrite. Admins can export current state for migration or private backup, but the export should be treated as sensitive operational data.

## Health And Readiness

Public service liveness:

```http
GET /v1/health
```

Returns only whether the service is responding:

```json
{
  "ok": true,
  "product": "ZeroLag",
  "time": "2026-06-28T00:00:00.000Z"
}
```

Admin readiness:

```http
GET /v1/admin/readiness
X-ZeroLag-Admin-Secret: ADMIN_SECRET
```

Returns a non-secret operational summary for private checks, including state-file status, backup status, update-manifest status, rate-limit status, data counts, and whether deployment secrets are still using development defaults.

Run `npm run server:smoke` before exposing the service. It starts a temporary local API instance, checks public health, and verifies the admin readiness endpoint using the loaded server secret configuration without mutating real membership state.

Admin maintenance cleanup:

```http
POST /v1/admin/maintenance/cleanup
X-ZeroLag-Admin-Secret: ADMIN_SECRET
```

Marks expired active subscriptions as `expired`, removes tokens that can no longer authorize a valid subscription, and writes a compact `maintenance.cleanup` audit event with the changed counts.

The server also runs the same cleanup automatically on startup and then on an interval. Use `ZEROLAG_MAINTENANCE_INTERVAL_MS` to adjust the interval, or set `ZEROLAG_MAINTENANCE_DISABLED=1` to disable automatic cleanup when an external scheduler owns maintenance.

## Configuration

The desktop client reads production endpoints from `assets/app-config.json`.

- `releaseMode`: use `production` for paid release builds.
- `apiBaseUrl`: HTTPS API base URL, for example `https://api.zerolag.example`.
- `websiteUrl`: HTTPS public website URL.
- `purchaseUrl`: HTTPS purchase or checkout page URL shown on the public website.
- `analyticsUrl`: HTTPS endpoint for privacy-safe public website CTA events.
- `supportUrl`: HTTPS support/contact page URL opened from the desktop toolbox.
- `updateManifestUrl`: HTTPS update metadata URL.
- `allowLocalDemoLicense`: must be `false` in production.
- `offlineGraceHours`: short validation grace window when the server is temporarily unreachable.

The license server reads deployment settings from environment variables. Before public release, run:

```powershell
npm run server:secrets
npm run server:secrets -- --write
npm run server:check
npm run server:check:strict
```

`server:secrets` generates strong private values for the three required server secrets. `--write` saves them to `.secrets/server.env`, which is ignored by Git.

Server-side commands automatically load `.secrets/server.env` when it exists. Existing system environment variables remain higher priority, so deployment hosts can override file values without editing the repository. Set `ZEROLAG_ENV_FILE` to use a different private env file for staging or deployment checks.

Minimum production server variables:

- `ZEROLAG_SERVER_SECRET`: custom strong secret for hashing activation codes and tokens.
- `ZEROLAG_ADMIN_SECRET`: custom strong secret for private admin endpoints.
- `ZEROLAG_PAYMENT_WEBHOOK_SECRET`: custom strong secret for payment callbacks.
- `ZEROLAG_SERVER_STATE_PATH`: durable server-state JSON location.
- `ZEROLAG_SERVER_BACKUP_DIR`: durable backup directory.
- `ZEROLAG_RATE_LIMIT_DISABLED`: must not be `1` in production.
- `ZEROLAG_SERVER_BACKUP_DISABLED`: must not be `1` in production.
- `ZEROLAG_MAINTENANCE_DISABLED`: must not be `1` unless another scheduler owns cleanup.

## POST `/v1/website/events`

Accepts privacy-safe public website CTA events from `analyticsUrl`.

The server stores aggregate counters only. Version, channel, and status counters are capped to 64 keys each, and daily counters keep the latest 90 days. It does not store client IPs, browser user agents, activation codes, tokens, order IDs, full URLs, or raw event payloads.

This endpoint supports cross-origin public website requests with `Access-Control-Allow-Origin: *` and accepts `OPTIONS` preflight checks. Admin, order, payment, and license endpoints do not share this public CORS behavior.

Allowed event names:

- `release_view`
- `download_click`
- `purchase_click`
- `support_click`
- `checksum_copy`
- `checksum_info_click`
- `cta_click`

Request:

```json
{
  "product": "ZeroLag",
  "event": "download_click",
  "detail": {
    "version": "1.0.0",
    "channel": "stable",
    "status": "available"
  }
}
```

Success response:

```json
{
  "accepted": true,
  "total": 42
}
```

Admins can inspect aggregate counts with:

```powershell
npm run server:admin -- analytics
npm run server:admin -- analytics-csv .\website-analytics.csv
```

## POST `/v1/licenses/activate`

Exchanges a member code or payment-issued activation code for a server-backed device license.

If the same device already has an active subscription for the same plan, activating a new unused paid code extends the existing subscription and returns the same `subscriptionId` with a later `expiresAt`.

Request:

```json
{
  "activationCode": "USER-CODE",
  "deviceHash": "sha256-device-id",
  "appVersion": "0.1.0",
  "channel": "stable"
}
```

Success response:

```json
{
  "active": true,
  "plan": "ZeroLag Pro 月度",
  "expiresAt": "2026-07-27T00:00:00.000Z",
  "token": "opaque-license-token",
  "subscriptionId": "sub_123",
  "sessionId": "sess_123"
}
```

Failure response:

```json
{
  "active": false,
  "message": "会员码无效"
}
```

## POST `/v1/licenses/validate`

Checks whether the current device and subscription can continue using Boost.

Request:

```json
{
  "token": "opaque-license-token",
  "subscriptionId": "sub_123",
  "deviceHash": "sha256-device-id",
  "appVersion": "0.1.0",
  "channel": "stable"
}
```

Success response:

```json
{
  "active": true,
  "plan": "ZeroLag Pro 月度",
  "expiresAt": "2026-07-27T00:00:00.000Z",
  "token": "rotated-license-token",
  "subscriptionId": "sub_123",
  "sessionId": "sess_456"
}
```

If the subscription is expired, refunded, revoked, moved to another device, or payment is overdue, return:

```json
{
  "active": false,
  "message": "会员已到期"
}
```

## Update Manifest

`updateManifestUrl` returns JSON:

```json
{
  "latest": "1.0.1",
  "minSupported": "1.0.0",
  "force": false,
  "title": "发现新版本",
  "message": "新版本已准备好。",
  "downloadUrl": "https://zerolag.example/download",
  "releaseNotes": ["优化启动速度", "提升状态检测稳定性"],
  "signatureAlgorithm": "RSA-SHA256",
  "signature": "base64-signature"
}
```

Production builds should sign update metadata and configure `updatePublicKeyPem`. Remote production manifests without a valid signature are rejected by the desktop client.

Generate and store keys privately:

```powershell
npm run update:sign -- --generate-keypair .\.secrets\update-private.pem .\.secrets\update-public.pem
```

Sign the manifest before upload:

```powershell
npm run update:sign -- assets\update.json .\.secrets\update-private.pem
npm run update:sign -- --verify assets\update.json .\.secrets\update-public.pem
```

Copy only the public key into production `assets/app-config.json` as `updatePublicKeyPem`. Never ship or commit the private key.

## POST `/v1/orders/create`

Creates a pending payment order. The MVP returns a manual-payment placeholder; production can replace this with WeChat Pay, Alipay, Stripe, or another provider.

Request:

```json
{
  "plan": "ZeroLag Pro Monthly",
  "deviceHash": "sha256-device-id",
  "channel": "website"
}
```

Response:

```json
{
  "ok": true,
  "order": {
    "orderId": "ord_123",
    "status": "pending",
    "plan": "ZeroLag Pro Monthly",
    "amountCents": 3000,
    "currency": "CNY",
    "activationCode": ""
  },
  "payment": {
    "provider": "manual",
    "paymentUrl": "zerolag://pay/ord_123"
  }
}
```

## GET `/v1/orders/:orderId`

Returns order status. Paid orders expose the generated activation code.

Response:

```json
{
  "ok": true,
  "order": {
    "orderId": "ord_123",
    "status": "paid",
    "activationCode": "ZL-PRO-ABC123-DEF456"
  }
}
```

## POST `/v1/payments/webhook`

Provider-neutral signed payment callback. Payment providers should call this endpoint after a payment succeeds. ZeroLag verifies the webhook signature, marks the matching order as paid, and issues a one-time activation code.

Headers:

```text
Content-Type: application/json
X-ZeroLag-Signature: sha256=<hmac_sha256(raw_body, ZEROLAG_PAYMENT_WEBHOOK_SECRET)>
```

Request:

```json
{
  "type": "payment.succeeded",
  "eventId": "evt_123",
  "orderId": "ord_123",
  "provider": "wechat_pay",
  "providerTradeId": "provider_trade_123"
}
```

Response:

```json
{
  "ok": true,
  "order": {
    "orderId": "ord_123",
    "status": "paid",
    "activationCode": "ZL-PRO-ABC123-DEF456"
  }
}
```

The endpoint is idempotent by `eventId`, so payment providers can safely retry the same event.

Refund request:

```json
{
  "type": "payment.refunded",
  "eventId": "evt_refund_123",
  "orderId": "ord_123",
  "provider": "wechat_pay",
  "refundTradeId": "provider_refund_123"
}
```

Refund response:

```json
{
  "ok": true,
  "order": {
    "orderId": "ord_123",
    "status": "refunded",
    "refundedAt": "2026-07-27T00:00:00.000Z"
  }
}
```

Refunds disable the related activation code, revoke subscriptions created from that code, and invalidate active server tokens.

## POST `/v1/admin/orders/refund`

Marks an order as refunded and revokes the related access. This is kept for private testing and manual support fixes.

Request:

```json
{
  "orderId": "ord_123",
  "refundTradeId": "manual_refund_123",
  "reason": "manual_refund"
}
```

Response:

```json
{
  "ok": true,
  "order": {
    "orderId": "ord_123",
    "status": "refunded",
    "refundedAt": "2026-07-27T00:00:00.000Z"
  }
}
```

## POST `/v1/admin/activation-codes`

Creates an activation code after an admin action or payment callback.

Request:

```json
{
  "code": "ZL-PRO-TEST-001",
  "plan": "ZeroLag Pro Monthly",
  "durationDays": 30,
  "maxUses": 1
}
```

Response:

```json
{
  "ok": true,
  "code": "ZL-PRO-TEST-001",
  "activationCode": {
    "plan": "ZeroLag Pro Monthly",
    "durationDays": 30,
    "maxUses": 1,
    "useCount": 0,
    "enabled": true
  }
}
```

## GET `/v1/admin/summary`

Returns a minimal operational summary for private testing.

Response:

```json
{
  "ok": true,
  "summary": {
    "activationCodes": { "total": 1, "enabled": 1, "used": 0 },
    "subscriptions": { "total": 0, "active": 0, "expired": 0 },
    "tokens": { "active": 0 }
  }
}
```

## GET `/v1/admin/export`

Exports the current server state for private backup, migration, or emergency support. This endpoint is admin-only and the response can contain sensitive operational data.

Response:

```json
{
  "ok": true,
  "exportedAt": "2026-07-27T00:00:00.000Z",
  "schemaVersion": 1,
  "stateSha256": "sha256-of-exported-state",
  "summary": {
    "orders": { "total": 2, "paid": 1 },
    "subscriptions": { "total": 1, "active": 1 }
  },
  "state": {
    "version": 1,
    "orders": {},
    "subscriptions": {}
  }
}
```

## POST `/v1/admin/orders/complete`

Marks an order as paid and creates a one-time activation code. This is kept for private testing and support; production payment platforms should use `POST /v1/payments/webhook`.

Request:

```json
{
  "orderId": "ord_123",
  "providerTradeId": "wechat_or_alipay_trade_id"
}
```

Response:

```json
{
  "ok": true,
  "order": {
    "orderId": "ord_123",
    "status": "paid",
    "activationCode": "ZL-PRO-ABC123-DEF456"
  }
}
```

## GET `/v1/admin/orders`

Lists recent orders for private testing and support.

Response:

```json
{
  "ok": true,
  "orders": [
    {
      "orderId": "ord_123",
      "status": "pending",
      "plan": "ZeroLag Pro Monthly",
      "amountCents": 3000,
      "currency": "CNY"
    }
  ]
}
```

## GET `/v1/admin/subscriptions`

Lists memberships for private testing and support. Optional filters:

```text
?status=active
?deviceHash=<full_sha256_device_hash>
```

Response:

```json
{
  "ok": true,
  "subscriptions": [
    {
      "subscriptionId": "sub_123",
      "status": "active",
      "active": true,
      "plan": "ZeroLag Pro Monthly",
      "expiresAt": "2026-07-27T00:00:00.000Z",
      "renewalCount": 1,
      "activationCount": 2,
      "device": "12345678...abcdef12"
    }
  ]
}
```

## GET `/v1/admin/subscriptions/:subscriptionId`

Returns one membership and its linked paid orders.

Response:

```json
{
  "ok": true,
  "subscription": {
    "subscriptionId": "sub_123",
    "status": "active",
    "active": true,
    "expiresAt": "2026-07-27T00:00:00.000Z"
  },
  "orders": [
    {
      "orderId": "ord_123",
      "status": "paid",
      "amountCents": 3000,
      "currency": "CNY"
    }
  ]
}
```

## POST `/v1/admin/subscriptions/revoke`

Manually revokes a membership, disables its related activation codes by default, and invalidates active server tokens.

Request:

```json
{
  "subscriptionId": "sub_123",
  "reason": "support_revoke",
  "disableActivationCodes": true
}
```

Response:

```json
{
  "ok": true,
  "subscription": {
    "subscriptionId": "sub_123",
    "status": "revoked",
    "active": false,
    "revokedAt": "2026-07-27T00:00:00.000Z"
  }
}
```

## GET `/v1/admin/audit-events`

Lists recent operational audit events for private testing, support, and payment troubleshooting. Events are intentionally compact and should not include activation codes or tokens.

Optional filters:

```text
?limit=50
?type=payment.succeeded
?targetId=ord_123
```

Response:

```json
{
  "ok": true,
  "events": [
    {
      "eventId": "aud_123",
      "type": "payment.succeeded",
      "actor": "webhook",
      "targetType": "order",
      "targetId": "ord_123",
      "createdAt": "2026-07-27T00:00:00.000Z",
      "metadata": {
        "paymentProvider": "wechat_pay",
        "hasActivationCode": true
      }
    }
  ]
}
```

## Payment Integration Point

The current MVP supports the activation-code path first because it is the fastest way to test paid membership without committing to a payment provider too early. A future account system can switch paid webhooks from issuing codes to creating account-bound subscriptions directly.
