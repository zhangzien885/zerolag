# ZeroLag Server API Contract

This is the first production client contract for account and subscription validation.

The runnable MVP server lives in `server/`. It is suitable for local integration testing and early private trials. Before a paid public release, move its JSON state into a real database, put it behind HTTPS, and connect payment webhooks.

Admin endpoints require the `X-ZeroLag-Admin-Secret` header.

## Configuration

The desktop client reads production endpoints from `assets/app-config.json`.

- `releaseMode`: use `production` for paid release builds.
- `apiBaseUrl`: HTTPS API base URL, for example `https://api.zerolag.example`.
- `websiteUrl`: HTTPS public website URL.
- `updateManifestUrl`: HTTPS update metadata URL.
- `allowLocalDemoLicense`: must be `false` in production.
- `offlineGraceHours`: short validation grace window when the server is temporarily unreachable.

## POST `/v1/licenses/activate`

Exchanges a member code or payment-issued activation code for a server-backed device license.

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
  "signature": "base64-signature"
}
```

Production builds should sign update metadata and configure `updatePublicKeyPem`.

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

## POST `/v1/admin/orders/complete`

Marks an order as paid and creates a one-time activation code. In production, a payment webhook should call this after verifying the provider signature.

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

## Payment Integration Point

Payment providers should call the backend after successful payment and either:

- create a subscription directly for the user's account and device; or
- create a one-time activation code that the desktop app can redeem.

The current MVP supports the activation-code path first because it is the fastest way to test paid membership without committing to a payment provider too early.
