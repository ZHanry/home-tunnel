# 栖云桥 / NestLink 12.0.0-RC1

统一的自建服务工作台，结合蓝白界面、原创桥形图标、内网穿透和认证加密的 P2P 远控。用户可见版本统一为 **12.0.0-RC1**，标签为 `v12.0.0-RC1`；本次为 GitHub Prerelease，不改变历史稳定通道或生产部署。

## 使用与迁移

- 启动后登录自建 HTTPS 服务，账号登录后获取设备和信令配置。CLI 使用 `login --server ... --username ... --password-file ...`。
- 新认证、设备会话和远控许可使用不可变契约 `api-v2.0.0`。管理会话、GUI 设备会话和后台穿透设备凭据分别管理。
- 移除 MFA、恢复码和设备接入码。事务迁移清除旧认证秘密并使旧管理会话失效；保留设备身份、有效后台设备凭据与穿透配置。升级前备份 SQLite、部署 secrets、设备状态及 hbbs 身份卷。
- 同账号设备目录隔离；同一服务可按设备 ID 跨账号协助，仍需被控端批准或密码验证。服务端短期许可绑定两端设备与会话，原生核心校验许可和设备签名。登录撤销会结束对应远控。
- 远控只允许加密的 P2P 直连，打洞失败会结束连接。HTTP/HTTPS、TCP/UDP 穿透、端口池、访问控制与流量治理继续通过独立 FRP/Agent 运行。独立 CLI/NAS 的有效凭据和租约不依赖 GUI 登录；撤销该设备会停止对应服务。

## 平台与发行身份

Windows x64 安装器；macOS Intel / Apple Silicon DMG；Linux x64 / ARM64 DEB；Android arm64 / x86_64 通用 APK；五平台 CLI/Agent 合集；服务端部署包、镜像和总仓分发材料。

全平台统一栖云桥 / NestLink 名称、图标和工作台入口，隐藏可见滚动条并保留滚轮、触控及键盘操作。密码凭据使用 Windows DPAPI、Android Keystore、macOS Keychain 或 Linux Secret Service。Android applicationId、原签名证书，以及 Windows/Linux 既有安装和配置身份保持兼容。

Windows 安装器目前没有 Authenticode 签名；macOS 使用 ad-hoc 签名，尚未完成 Apple notarization。系统可能要求确认打开。发行附件包含最终构建字节、SHA-256、对应源码、许可证和构建证据，下载清单只登记独立核验过的实际发布附件。

## 验证范围

界面、账号续期与撤销、迁移、契约签名、原生构建、模拟器、安装与可复现联调分别记录证据。源码或模拟数据测试不能证明媒体已经通过 P2P 传输。

真机 Android、不同运营商/NAT/IPv6 网络、长期画面与音频、24 小时稳定性尚未完成，均列为未验证项目。具体自动化和联调结果以该版本材料中的构建与验收记录为准；缺少发布门槛所需的原生构建或可复现联调时不发布 RC。
