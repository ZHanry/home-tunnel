# NestLink 12 候选范围

| 能力 | 实施状态 | 验收边界 |
| --- | --- | --- |
| HTTP/HTTPS 与受控 TCP/UDP 穿透 | 保留原 Agent/FRP、端口池、权限、ACL、流量治理和诊断 | 托管生产路径 smoke 记录于 Server 材料；不是每个家庭网络的保证 |
| 独立 CLI/NAS/background Agent | 五平台合集；Agent 从同一 RC1 源提交构建 | 远控与 GUI 生命周期分开，按平台说明配置 |
| 栖云桥 Web 管理台 | 账号设备、服务、管理与原生入口 | Web 不承载远控媒体 |
| Windows 原生 NestLink | Rust/Flutter，栖云桥界面与受管 helper | 构建、控件与安装器测试；Windows 未 Authenticode 签名 |
| Android 同源界面 | 固定 Client Git 子模块；arm64/x64 通用 APK | API26/35 Keystore/启动检查；真实手机与远控媒体待验收 |
| 认证加密的 P2P 远控 | 全入口和最终连接守卫要求直连 | NAT、移动网络、持续屏幕/输入/声音/剪贴板/文件待实测 |
| 中继或厂商回退 | 禁止 | 打洞失败即停止 |
| hbbs 身份与目录 | 原 SQLite、全局 ID 唯一、账号隔离、撤权清除；身份可加密备份 | 近期登记不是媒体在线 |
| macOS/Linux 原生 GUI | macOS Intel/Apple Silicon DMG，Linux x64/ARM64 DEB | 原生构建、真实 Keychain/Secret Service、安装启动卸载检查 |
| 旧 WebRTC/DTLS 远控兼容 | 退出 12.x 生产路径 | 原发布与历史证据保留 |

当前候选不声明所有 RustDesk 上游能力已在此产品上验收。源码、单元、界面、构建、模拟器与安装校验各自有明确范围；不能替代两台实际终端与跨网络长期会话。
