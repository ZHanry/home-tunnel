# 功能矩阵 / Feature matrix

稳定版是 9.0.0。10.0.0 列的是计划，验收尚未完成。不要把计划列当成已经支持。

| 能力 | 9.0.0 已发布 | 10.0.0 计划 | 10.0 验收 |
| --- | --- | --- | --- |
| 授权 UDP 远控 | 临时批准、固定密码、一次性临时密码；载荷只走 UDP | 仍只走 UDP，不增加载荷中继 | 尚未完成 |
| 无人值守 | 未作为默认能力交付 | 必须显式开启 | 尚未完成 |
| 安全桌面 / 锁屏 / 登录 / UAC | 未交付 | Windows 服务与会话代理 | 尚未完成，不能写成已支持 |
| 系统音频 | 未交付 | 授权后的系统播放 | 尚未完成，不能写成已支持 |
| 双向文件 | 9.0 组件证据有范围限制，不是跨端验收 | 进度、取消、SHA-256、清理 | 尚未完成，不能写成已支持 |
| 剪贴板 | 文本路径存在限制，跨端互通未验收 | 计划保持文本和显式授权 | 尚未完成 |
| FRP 发布 | HTTP/HTTPS、TCP、UDP，FRP 0.70.1 | 向导，以及 NAS、Home Assistant、Immich、Jellyfin、SSH、RDP、RTSP 模板 | 尚未完成 |
| Android | 已发布 arm64 APK；模拟器不能代替真机 | x64 控制端计划与 arm64 限制分开记录 | 尚未完成 |
| 契约 | `api-v1.3.0` | `api-v1.4.0` 计划中，未冻结 | 尚未完成 |
| 9 到 10 迁移 | 不适用 | 备份后协同升级，不长期混跑 | 尚未完成 |
| 签名 | Windows/macOS 未配置发行证书；Android 证书 `d7779e338be1039acee6dda9a43417cbf2baf4b0c9995578d9708501e95af702` | 没有新的 Authenticode 或 Developer ID 身份 | 不能宣称已签名 |

历史细节在 [发布说明](RELEASE_NOTES.md)。8.0 的逐项记录在 [docs/8.0/ACCEPTANCE.md](8.0/ACCEPTANCE.md)，只作为历史证据。

## English

The stable column is 9.0.0. The 10.0.0 column is a plan. Acceptance is pending, including secure desktop, audio, bidirectional files, the tunnel wizard, migration, and stable downloads. Desktop packages remain unsigned.
