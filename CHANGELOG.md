# Changelog

## 7.0.0 — 2026-09-19

All first-party components and the managed Agent now use 7.0.0. Upgrade the server,
desktop/CLI and Android together; FRP remains at its independent 0.70.1 version.

- Fix Web multi-tab refresh, stale access-policy writes and persistent backup health.
- Reject unverified/incomplete desktop updates and use stable semantic versions.
- Add full REST OpenAPI/JSON Schema and capability-driven Android transport controls.
- Add TOTP/recovery codes, session management and single-use enrollment codes.
- Add OS credential protection, redacted diagnostics and host-only admin recovery.
- Add encrypted off-host backup, verified fresh-volume restore, preflight/NAS
  templates, monitoring and alert rules.
- Add encrypted Android server profiles, tags/favorites and per-item batch operations.
- Publish checksums, SBOMs, provenance and verification evidence as durable assets.

Windows/macOS have no publisher certificates configured and are explicitly unsigned;
their signing/notarization workflow is ready. Android retains its release signing
identity. Read the migration and platform-security guides before upgrading.

## 6.0.0 — 2026-09-09

Home Tunnel 6.0 正式发布。Web、桌面与手机端采用全新的页面结构，统一使用清晰的设备与账号边界。

四个仓库同步升级。项目网站、下载入口与使用文档全面更新，各平台安装包请访问对应组件的 Release。


## Unreleased · 正式发布

- 当前仓库负责项目介绍、网站和跨组件文档。
- 统一开发文档、源码构建入口和正式发布状态。
- 自动化检查与真实环境反馈共同用于后续功能完善。

以下为 5.x 早期版本的历史记录；从 6.0 起按正式发布流程维护。
后续用户可见变化在这里记录，并注明影响到的接口、配置和测试步骤。

## 5.0.1 安全维护版本

- 客户端加入本地会话授权、同源保护、请求边界和日志脱敏，更新实际 Agent 依赖。
- 服务端修复请求限流、授权头解析和主机名比较，更新 FRPS 安全依赖镜像。
- 组件安全检查会验证未处理告警；已迁出本仓库的历史告警保留审查记录。
- 修复版产物由各组件仓库发布，入口见 [下载版本](docs/DOWNLOADS.md)。
