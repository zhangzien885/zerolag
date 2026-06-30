<!-- zerolag-formal-release-guide-v1 -->

# ZeroLag 正式版资料填写指南

这份指南只解决一个问题：把 ZeroLag 从“本地测试版”切到“可以准备公开收费发布”的真实资料收齐。

把 `.secrets/formal-release-inputs.json` 当成发布清单，不要把它当成存密码的地方。支付密钥、证书密码、私钥正文都不要填进 JSON，只用 `true / false` 表示这些机密是否已经放在私有环境变量、CI Secret 或安全目录里。

## 先跑这四个命令

```powershell
npm run release:inputs -- --init
npm run release:inputs -- --guide
npm run release:inputs
npm run release:next
```

如果第一条提示文件已存在，不用覆盖，直接看第二条指南和第三条校验。

## 不想手改 JSON 时

如果你已经买好正式根域名，可以先用 `--domain` 一次性生成官网、API、CDN、支付回调、更新目录和客服入口：

```powershell
npm run release:inputs -- --domain zerolag.gg
```

这个命令会自动写入：

- `domains.website=zerolag.gg`
- `domains.api=api.zerolag.gg`
- `domains.cdn=cdn.zerolag.gg`
- `payment.checkoutUrlTemplate=https://pay.zerolag.gg/checkout/{orderId}`
- `payment.webhookUrl=https://api.zerolag.gg/v1/payments/webhook`
- `release.cdnReleaseBaseUrl=https://cdn.zerolag.gg/releases`
- `support.supportUrl=https://zerolag.gg/support`
- `support.contactEmail=support@zerolag.gg`

也可以用 `--set 字段=值` 安全写入或覆盖单个字段：

```powershell
npm run release:inputs -- --set domains.website=zerolag.gg
npm run release:inputs -- --set domains.api=api.zerolag.gg --set domains.cdn=cdn.zerolag.gg
npm run release:inputs -- --set payment.provider=wechat_pay
npm run release:inputs -- --set codeSigning.profile=production --set codeSigning.passwordConfigured=true
```

`--set` 只允许写入公开配置、商户标识、文件路径和 `true / false` 状态。支付 API Key、证书密码、私钥正文这类敏感内容会被拒绝写入。

## 必填资料

| 你要准备什么 | 从哪里拿 | 填到哪里 | 为什么需要 |
| --- | --- | --- | --- |
| 正式版本号 | 你自己决定，首个收费版建议 `1.0.0` | `version.target` | 安装包、更新信息、官网展示都要用同一个版本号。 |
| 官网域名 | 域名服务商，例如阿里云、腾讯云、Cloudflare | `domains.website` | 客户下载、购买、看介绍都需要稳定入口。 |
| API 域名 | 服务器或反向代理绑定的 HTTPS 域名 | `domains.api` | 软件登录、会员校验、支付回调都要访问后端。 |
| 下载/CDN 域名 | CDN、对象存储或下载服务器 | `domains.cdn` | 安装包和更新文件不能长期放在本地电脑。 |
| 支付方式 | 微信支付或支付宝商户后台 | `payment.provider` | 正式收费必须选择真实支付渠道，不能用 `manual`。 |
| 收银台链接模板 | 你的支付服务生成的下单链接规则 | `payment.checkoutUrlTemplate` | 软件创建订单后，要能把用户带到正确付款页。 |
| 支付回调地址 | 你的后端支付 webhook 地址 | `payment.webhookUrl` | 支付成功后，后端要自动给账号发会员。 |
| 微信支付商户资料 | 微信支付商户平台 | `payment.wechatPay.*` | 只在 `provider` 选择 `wechat_pay` 时必填。 |
| 支付宝商户资料 | 支付宝开放平台 | `payment.alipay.*` | 只在 `provider` 选择 `alipay` 时必填。 |
| 正式代码签名证书 | OV/EV 代码签名证书供应商 | `codeSigning.profile` 和 `codeSigning.certificateSource` | 公开安装包需要减少系统拦截和“不受信任”提示。 |
| 证书密码是否已配置 | 私有环境变量或 CI Secret | `codeSigning.passwordConfigured` | 只填 `true / false`，不要写真实密码。 |
| 正式更新目录 | CDN 上的 release 文件夹 | `release.cdnReleaseBaseUrl` | 自动更新要从这里下载安装包和校验信息。 |
| 安装包文件名 | 最终构建出来的安装包名称 | `release.installerName` | 官网和更新清单要指向同一个文件。 |
| 客服入口 | 官网客服页、工单页或联系页 | `support.supportUrl` | 付款、激活、下载失败时客户要能找到你。 |

## 填写原则

- 域名必须是真实公网 HTTPS，不要用 `example`、`localhost`、`.test` 或占位符。
- 支付方式只能选 `wechat_pay` 或 `alipay`，正式收费前不要继续用 `manual`。
- 微信支付或支付宝的私钥文件只写“文件路径”，不要把私钥内容粘进去。
- 证书密码、支付 API Key、Webhook Secret 都放到 `.secrets/server.env`、系统环境变量或 CI Secret，不要放到这个 JSON。
- 每改完一轮就跑 `npm run release:inputs`，让脚本告诉你还差哪一项。

## 填完以后

当 `npm run release:inputs` 通过后，再跑：

```powershell
npm run release:next
```

它会继续告诉你下一步应该做什么，例如写入生产 URL、配置服务器支付环境、准备更新清单、切到 production 模式、生成官网发布信息或跑最终发布门禁。
