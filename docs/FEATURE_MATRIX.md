# 功能矩阵 / Feature matrix

稳定组合为 Server / Client 10.1.0 + 兼容保留的 Android 10.0.0。“实测”只指实际证据范围；未运行项目不计为通过。

| 能力 | 10.1 稳定组合 | 验证边界 |
| --- | --- | --- |
| 原生登录与设备管理 | 单次、短时、仅限远控的登录交接；阻止连接本机；当前设备改名 | 需要 Server / Client 10.1.0 和冻结增量契约 `api-v1.5.0`；完整最终 GUI 交互未验收 |
| 审批与界面 | 修复 Windows 审批弹窗底色/显示时机；合并设置与更新；改善登录布局 | 完整审批、固定密码、临时密码界面流程未验收 |
| 远控传输 | 端到端 DTLS 加密 UDP，优先直连；浏览器可用可选 UDP TURN；Android 与 9.x 被控端只走直连 | 本轮为同机隔离回环，不能证明 NAT、IPv6、UDP 被封或断网恢复 |
| 原生画面与输入 | Windows worker 画面、键鼠与中文输入 | 10.1.0 原始 worker、同机 Chromium 与生产源码 QA host；不代表完整安装版 GUI/服务或独立 Windows 终端 |
| 连接与活动 | 30 次连接；7202.463 秒活动；1391 次采样 | 限上述测试环境；24 小时在线与账号令牌刷新未验证 |
| 崩溃与重启 | 输入释放检查；显式 QA host 重启后新配对 3507.7 ms 恢复输入 | 不能证明自动服务重启或断网恢复 |
| Android | 保留 10.0.0 arm64-v8a / x86_64 原 APK、版本、证书和摘要 | Android 控制 Windows、实体 arm64、最终 APK 的 API 26/35 运行未验证 |
| 系统声音 / 剪贴板 / 双向文件 | 保留 10.0 功能范围，文件使用 SHA-256 | 本轮原生长测未覆盖；10.0 开发构建记录只保留为历史 |
| 多显示器 / DPI | 保留既有功能范围 | 未验证 |
| 安全桌面 / 锁屏 / 登录前 / UAC | 不可用 | 不适用 |
| 麦克风回传 | 不可用 | 不适用 |
| FRP 发布 | FRP 0.70.1，HTTP/HTTPS、TCP、UDP 与引导式发布 | 隧道运行矩阵未验证 |
| 升级与恢复 | 先备份，使用匹配版本与固定镜像摘要 | 完整安装器升级与备份恢复未验证 |
| Linux / macOS | 提供 10.1.0 客户端包 | 运行未验证 |
| 签名 | Windows Authenticode / macOS Developer ID 未配置；Android 保留原发行证书 | 哈希、Sigstore 和扫描不等于发行商签名 |

完整边界见 [发布说明](RELEASE_NOTES.md)。历史 10.0.0、9.0.0 和 [8.0 验收](8.0/ACCEPTANCE.md) 只说明各自版本，不能替代 10.1.0 最终产物验证。网站现有产品截图仍为标明的 10.0.0。

## English

Server / Client use 10.1.0; compatible Android 10.0.0 files remain unchanged. The original 10.1.0 Windows worker bytes passed 30 connections and 7202.463 seconds of activity with 1391 samples, using same-machine Chromium and a production-source QA host in an isolated loopback environment. After an explicit QA host restart, a new pairing restored input in 3507.7 ms. This does not establish full installed-GUI, Windows service, independent Windows-endpoint, Android, network-outage recovery, 24-hour online, or Linux/macOS runtime acceptance. Audio, clipboard, files, full authorization UI flows, multi-display, installer upgrade/restore and the network matrix are not established by this run. The 24-hour test was not run. Desktop packages remain unsigned; secure desktop and microphone return remain unavailable. Historical 10.0.0 evidence and screenshots keep their original scope and labels.
