# Home Tunnel 5.0.0

5.0 focuses on reliable operations and a clearer interface across the web console, desktop client and Android management app.

## 本次更新

- 连接管理改为响应式卡片，加入搜索、分页、暂停与诊断详情。
- 修复带宽整数校验、语言和主题重复切换、会话失效与保存失败反馈。
- 实时刷新保留正在输入的内容和焦点；断线时明确标注缓存状态。
- 子域检查按目标账号与当前连接执行，修正前缀和自身占用判断。
- 保留非敏感草稿，提供版本冲突后的明确恢复与重新提交路径。
- 增加主动修改密码、月度额度自查与准确的组件健康状态。
- 桌面客户端支持 Enter 提交、密码显示、首次改密引导和请求状态。
- Android 在保存成功后关闭编辑器，并提供刷新、缓存提醒和冲突恢复。
- 将浏览器交互、桌面网页检查和发布脚本验证纳入持续检查。

对应审计问题与验证方式见 [5.0 验证记录](https://github.com/ZHanry/home-tunnel/blob/main/docs/UX_5_VALIDATION.md)。

## Downloads

- **Windows x64:** `HomeTunnel-Setup-5.0.0-x64.exe` or `HomeTunnel-Windows-5.0.0-x64.zip`.
- **Linux amd64 / arm64:** `home-tunnel-linux-5.0.0-<arch>.tar.gz`.
- **macOS amd64 / arm64:** `home-tunnel-macos-5.0.0-<arch>.tar.gz` (Beta).
- **Android 8.0+ arm64:** `HomeTunnel-Android-5.0.0-arm64-v8a.apk` (Experimental). Android manages remote devices; it does not run a tunnel Agent on the phone. The AAB is not directly installable.

Verify the signed `SHA256SUMS.txt` and accompanying Sigstore evidence before installing. The Android APK keeps the project's persistent release certificate. Windows binaries do not carry a trusted Authenticode publisher certificate, so Windows may show an unknown-publisher prompt; the signed artifact manifest is a separate verification mechanism.

## Upgrade

1. Back up SQLite consistently and retain `.env`, deployment secrets, the FRPS TLS certificate, and any existing-Caddy override.
2. Upgrade the control-center and traffic-gateway images together. Database migrations run on startup; preserve the database volume.
3. Keep the reviewed FRPS `0.70.1-r2` dependency and existing TCP/UDP enablement and firewall settings. The upgrade does not require enabling new public ports.
4. Update clients through the matching packages and verify device synchronization and public access.

The administrator connection-list endpoint now includes pagination metadata. Integrations must follow subsequent pages instead of assuming one response contains every connection. Client connection endpoints and the v1 transport contract remain compatible.

Stable promotes the same commit, immutable image digests and artifact bytes accepted by the matching RC. The release includes service smoke, backup/restore and platform verification evidence. Automated checks are distinct from a physical-device usability certification.
