# HomeDesk 11 验证记录

各仓材料包记录精确源码与实际构建的验证，范围分开列出：

- Server：原权限、SQLite 迁移、API、设备目录、Web 控件、完整 HTTP/TCP/UDP 穿透生产路径，以及隔离 hbbs 启动、IPv4/IPv6 监听、身份重启与加密恢复。
- Client：严格 P2P 守卫、门户 API/TLS、Windows DPAPI、单次交接、Flutter 控件、独立 Go 穿透、Windows 原生构建与安装/卸载校验。
- Android：固定共用源码、两个 native ABI、API26/35 模拟器真实 Keystore 篡改拒绝与启动检查，原证书与应用身份/ABI 校验。
- 总仓：候选/稳定通道、历史冻结字节、链接/网站、真实 Release 下载 SHA 与 Sigstore 工作流签名。

**待验收**：跨网络 NAT、持续屏幕/输入/音频/剪贴板/文件会话、两台实际安装终端、Android 真机，以及设备/网络能力与性能矩阵。候选门禁通过不把这些项目标成通过。历史 10.x 的长测、截图和验收文件只说明旧版本。
