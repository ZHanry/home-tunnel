# 升级 / Upgrade

当前的安装组合是四个仓库的 **10.0.0**，加上独立的 FRP **0.70.1**。从 9.0.0 升级时，服务端、桌面和 Android 一起升，不长期混跑。

## 9.0.0 升到 10.0.0

1. 先做异机备份，并确认能在隔离环境恢复。步骤在[服务端恢复文档](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md)。
2. 结束正在进行的远控会话。
3. 按[服务端升级说明](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md)升级服务端，使用 Release 的 `compose.release.yaml` 固定镜像摘要。迁移 020、021 是增量迁移，9.0 数据仍可读取。需要浏览器中继时再部署 `deploy/compose.turn.yaml`（coturn）。
4. 升级同版桌面和 Android。
5. 用原来的账号登录，确认设备和已有 FRP 连接还在，从另一张网络访问一个已知服务，再试一次远控。

远控默认关闭。9.x 被控端仍只有画面、键鼠和剪贴板，也不走中继。

## 验证到哪里

10.0.0 的远控实测是在从 9.0.0 升级的生产服务器上做的。9→10 安装器升级、备份恢复、30 次连续连接、2 小时和 24 小时运行都没有运行，由负责人豁免，不能当作已验证。升级前务必自己确认备份能恢复。清单见 [发布说明](RELEASE_NOTES.md) 和 [发布证据](release/README.md)。

## 回滚

出问题时先停止继续升级，按备份文档恢复。不要让 9.0 服务端直接跑在已迁移的 10.0 数据库上。9.0.0 的发布页仍然可以下载。

## English

Upgrade server, desktop and Android together from 9.0.0 to 10.0.0; FRP stays 0.70.1. Back up and prove a restore first, end remote sessions, then follow the server upgrade guide with the release `compose.release.yaml`. Deploy `deploy/compose.turn.yaml` only if browser viewers need the relay. The installer upgrade, backup restore and long-running soaks were waived by the owner and are not verified.
