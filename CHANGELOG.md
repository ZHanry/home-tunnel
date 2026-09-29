# Changelog

## 10.0.0 — 2026-09-29

All four repositories and the managed Agent use 10.0.0; FRP stays at 0.70.1. The API stays `/api/v1` and freezes contract `api-v1.4.0`.

- Remote payloads use end-to-end DTLS-encrypted UDP, direct P2P first. An optional UDP TURN relay (coturn, `deploy/compose.turn.yaml`) lets browser viewers reach 10.0.0 hosts when direct fails; the relay cannot read payloads and there is no TCP fallback. Android controllers and 9.x hosts are direct-only.
- Hosting is on after sign-in, with a bottom-right approval popup, a "being remotely controlled · disconnect" bar and a grouped 9-digit device ID. The one-time temporary password uses the fixed device ID; a fixed password skips approval.
- An accepted connection gets screen, input, clipboard, files and system audio (WASAPI loopback). The microphone is never auto-approved.
- Redesigned browser viewer with a floating toolbar and background clipboard sync; guided service publishing; localization, theme and accessibility fixes.
- Android uses the same-source SDK for arm64-v8a and x86_64 and adds audio playback, file transfer, monitor selection and keyboard-safe layouts (versionCode 10000000).
- The hub records stable and candidate channels in one `distribution.json` and documents owner waivers for gates that were not run.

Published with owner waivers: a waiver is not a pass. Lock screen, pre-login and UAC secure-desktop control and microphone return are not available; Windows/macOS packages are unsigned. See [release notes](docs/RELEASE_NOTES.md) for what was verified and what was waived.

## 9.0.0 — 2026-09-24

- Refresh the website, Windows client and Android navigation and visual identity.
- Separate remote desktop from tunnels and add host-approved requests, fixed passwords and one-use temporary passwords.
- Pin API 1.3 and publish verified component downloads with their actual checksums.
- Keep direct UDP P2P for remote-control payloads and preserve the 7.0 tunnel compatibility path.

Windows secure-desktop control and audio remain unavailable. Android arm64 runtime and real-device decoding, clipboard interoperability, cross-network and long-running acceptance remain unverified. See [release scope](docs/RELEASE_NOTES.md).

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
