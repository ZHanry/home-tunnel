# HomeDesk 11.0.0 候选发行

整合 Hearth 暖居 Web 与 Rust/Flutter 原生客户端，同时完整保留原内网穿透。Server 11.0.0-rc.2；Client、Android 与分发仓 11.0.0-rc.1；Agent 10.1.0，FRP 0.70.1，冻结 API api-v1.6.0。Server 早期 RC.1 发布检查失败的 tag 保留，未发布其附件；修复使用新的 RC.2。

远控所有入口与最终成功条件要求认证加密的 P2P 直连。只增加 hbbs 信令，64 MB 内存上限，无 hbbr/TURN/FRP/HTTP/WSS/VPN/厂商回退。打洞失败停止。暖居 Web 使用 ID-only homedesk URL 打开原生应用，原媒体引擎退出生产路径。

HTTP/HTTPS、受控 TCP/UDP、端口池、权限、ACL、流量治理、诊断与独立 CLI/NAS/background Agent 保留。Windows 发布 x64 安装器；CLI/Agent 一包覆盖 Windows x64、Linux amd64/arm64、macOS amd64/arm64；Android 保留原 app ID 与证书，通用 APK 包含 arm64/x64。macOS/Linux 原生 GUI 暂未发行，Windows 未 Authenticode 签名。

精简附件为 Server 3、Client 4、Android 3、分发 2 个。源码（包括 AGPL 对应源码）、精确子模块、依赖材料、许可证、构建证据与 GitHub 身份证明集中在材料 ZIP；校验文件覆盖所有公开包。下载清单只记录实际发布并独立核对的源码 revision 与哈希。

升级前备份 SQLite、部署 secrets、客户端状态和独立 hbbs 身份卷。旧远控兼容不作为目标，不叠加旧远控/TURN Compose。通用安装包没有内置服务器、公钥或凭据，按组件 README 配置自己的服务。

跨网络 NAT、长期远控媒体、Android 真机和完整两端安装后的远控验收尚未完成。源码、单元、控件、构建、模拟器与安装检查不能替代这些验证，候选不晋升稳定版。下方原始 10.x 说明与机器证据仍仅适用于各自历史发行。


本仓只有 HomeTunnel-Distribution-11.0.0-rc.1.zip 与 SHA256SUMS.txt。ZIP 含精确本仓源码、分发清单、部署/升级/兼容说明和三仓实际附件校验证据；本仓源码身份由不可变 tag 与内部签名 BUILD.json 解析，避免自引用哈希。
