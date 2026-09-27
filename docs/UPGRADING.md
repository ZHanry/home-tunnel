# 升级 / Upgrade

现在的安装组合是四个仓库的 **9.0.0**，加上独立的 FRP **0.70.1**。
10.0.0 的迁移验收尚未完成。在那之前，不要把开发构建和 9.0.0 生产环境长期混跑。

## 停留在 9.0.0

1. 先做异机备份，并确认能在隔离环境恢复。步骤在[服务端恢复文档](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md)。
2. 结束正在进行的远控会话。
3. 按[服务端升级说明](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md)升级服务端，再升级同版桌面和 Android。
4. 用原来的账号登录，确认设备和已有 FRP 连接还在，再从另一张网络访问一个已知服务。

旧服务端不提供 9.0 的三种远控授权。7.0 和 8.0 的发布页仍然可以下载。

## 计划中的 9 到 10

协同升级的目标是：备份、停止远控、升级服务端和客户端、做一次恢复演练，然后只跑 10.0.0。
不把长期混版本当作支持状态。`api-v1.4.0` 尚未冻结。
虚拟机迁移、30 次连续连接、2 小时活动和 24 小时在线都还没有作为 10.0 证据提交。
未跑、过期、缺失或不匹配的门禁会失败关闭，不能用夹具充数。见 [发布证据](release/README.md)。

## English

Stay on the published 9.0.0 set until 10.0.0 acceptance exists. Back up, end remote sessions, then follow the server upgrade guide. The planned 9-to-10 move is coordinated and does not include long-term mixed-version operation. That migration has not been accepted.
