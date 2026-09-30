# 功能矩阵 / Feature matrix

稳定版是 10.0.0。"实测"只写实际测过的部分；未运行的项目标为"未验证"，不计为通过。

| 能力 | 10.0.0 | 验证范围 | 9.0.0（上一版本） |
| --- | --- | --- | --- |
| 远控传输 | 端到端 DTLS 加密 UDP，优先直连；浏览器控制端可经可选 UDP TURN 中继连接 10.0.0 被控端，中继读不到内容；没有 TCP 回退 | Web → Windows 直连与中继实测；NAT、IPv6、UDP 被封与网络恢复矩阵未验证 | 只走 UDP 直连，没有中继 |
| Android 控制端 | arm64-v8a 与 x86_64 同源 SDK；只走直连 | Android 控制 Windows、实体 arm64 手机、最终 APK 的 API 26/35 模拟器运行未验证 | arm64 APK；模拟器不能代替真机 |
| 被控与授权 | 登录即开启被控，右下角审批弹窗，"正在被远程控制 · 断开"条，分组 9 位设备 ID；临时密码用固定设备 ID；固定密码跳过审批 | 审批弹窗和临时密码实测；最终构建上的固定密码未验证 | 临时批准、固定密码、一次性临时密码 |
| 接受后的权限 | 本次连接放行画面、键鼠、剪贴板、文件、系统声音；麦克风从不自动放行 | 画面、键鼠、中文输入实测 | 画面、键鼠、剪贴板 |
| 系统声音 | WASAPI 回环（普通桌面）；Android 可播放 | Web → Windows 实测 | 未交付 |
| 文件传输 | 双向，SHA-256 校验 | 控制端 → 被控端实测；被控端 → 控制端未验证 | 组件证据有范围限制 |
| 剪贴板 | 浏览器后台同步 | 双向实测 | 跨端互通未验收 |
| 多显示器 / DPI | Android 可选显示器 | 多显示器与 DPI 未验证 | 未验收 |
| 安全桌面 / 锁屏 / 登录前 / UAC | 不可用 | 不适用 | 不可用 |
| 麦克风回传 | 不可用 | 不适用 | 不可用 |
| FRP 发布 | FRP 0.70.1，引导式服务发布 | 隧道运行矩阵未验证 | HTTP/HTTPS、TCP、UDP |
| Linux / macOS | 客户端包照常提供 | Linux 与 macOS 运行未验证 | 同左 |
| 契约 | `api-v1.4.0` 已冻结 | 不适用 | `api-v1.3.0` |
| 9 到 10 升级 | 服务端迁移 020、021 为增量迁移 | 生产服务器从 9.0.0 升级后实测；9→10 安装器升级与备份恢复未验证 | 不适用 |
| 长时间运行 | 不做承诺 | 30 次连续连接、2 小时和 24 小时未验证 | 未验收 |
| 签名 | Windows/macOS 未签名；Android 证书 `d7779e338be1039acee6dda9a43417cbf2baf4b0c9995578d9708501e95af702` | 不适用 | 同左 |

实测来自同一功能代码的开发构建，没有在最终字节上重跑。完整清单在 [发布说明](RELEASE_NOTES.md)。8.0 的逐项记录在 [docs/8.0/ACCEPTANCE.md](8.0/ACCEPTANCE.md)，只作为历史证据。

## English

Stable is 10.0.0. Verification remains incomplete. Remote payloads use end-to-end DTLS-encrypted UDP, direct first, with an optional UDP TURN relay for browser viewers; Android and 9.x hosts are direct-only. Web-to-Windows screen, input, clipboard, viewer-to-host files, system audio, approval and temporary password were tested on development builds. Host-to-viewer files, fixed password on the final build, Android control, multi-monitor, upgrade and restore, soaks, the network matrix and Linux/macOS runtime were not run and remain unverified. Secure desktop and microphone return are unavailable. Desktop packages remain unsigned.
