# 从 10.x 升级到 HomeDesk 11 候选版

目标组合是 Server 11.0.0-rc.2、Client / Android 11.0.0-rc.1、Agent 10.1.0、FRP 0.70.1。这是候选组合，跨网与实机验收尚未完成。原稳定通道与旧 Release 保持原样；升级不会把历史验收重算为新版本通过。

1. 保存旧安装包与部署配置，备份 SQLite、secrets、客户端状态与 hbbs 密钥卷。数据库迁移后的回退必须使用原备份，不能让旧服务读取新结构而假定兼容。
2. 核对实际附件 SHA256SUMS，先升级 Server。SQLite 迁移新增 HomeDesk 目录，不删除原穿透设备、连接、权限、端口池、ACL 和流量治理数据。按自建说明初始化 hbbs，并配置它的地址和公钥。
3. 停止历史远控组件和 `compose.rd.yaml` / `compose.turn.yaml` 覆盖；11.x 不承诺旧媒体会话兼容。不要停止独立穿透 CLI/NAS 服务，除非升级它本身。
4. Windows 安装 HomeDesk x64 候选，配置 HTTPS 管理台与自己的 hbbs 公钥。Android 通用 APK 保留原 applicationId 和发行证书，versionCode 11000001；切换 UI/核心后检查本机设置。新远控身份需重新登记。
5. 验证原 HTTP/HTTPS 服务、受控 TCP/UDP、权限、ACL、端口池、流量限制、诊断和长期 CLI 仍正常，再验证账号目录与两台独立设备的安全 P2P。直连失败不会回退中继。

Windows 包没有 Authenticode 发行签名。不要把材料中的 Sigstore 构建证明当作 Windows 发行商签名。Android 14/15 每次共享屏幕需从可见应用重新取得系统采集授权，不从启动广播自动捕获。

回退时先停止新组件，将 SQLite 和部署秘密恢复为旧版本备份，再运行对应原发行字节。hbbs 公钥变化会破坏客户端信任，需要恢复原身份或明确重新配置。两套版本不共用一个在线 SQLite 文件。
