# D14 Zhihu adaptation draft

Use this only if D14 Pages unique visitors are below 80. If traffic is at least 80 but Quick Start click-through is below 15%, improve the hero and installation flow instead of publishing another channel adaptation.

## Owner review gate

- Insert the real D14 aggregate metric only after comparing dated D0/D7/D14 snapshots.
- Re-check the live Release and support matrix.
- Confirm the exact title, body, topic, cover, account, and links before publishing.
- Never expose raw referrers or quote deployment feedback without permission.

## Title

家庭内网穿透不只是“把 FRP 跑起来”：一个可撤销控制面需要什么？

## Opening

如果一个家庭服务通过隧道能从外网访问，系统是否已经安全？我的答案是：隧道解决了连通性，但没有自动解决身份、授权、撤销、限速、审计和恢复。

我在做 Home Tunnel 时，把问题拆成了五个可验证的判断：

1. 客户端只能申请明确允许的能力，而不是任意 FRP 配置；
2. 撤销设备或连接后，活动流量会真正停止；
3. 单个连接、用户和整体资源都有边界；
4. 实时同步失败后仍有安全收敛路径；
5. 数据库升级、备份与恢复有失败测试，而不只是成功脚本。

## Main answer

### 连通性和授权是两回事

FRP 负责传输，Home Tunnel 的控制中心负责用户、设备、连接和短期租约。家庭设备上的 Agent 有本地白名单，只接受 HTTP/HTTPS、验证过的自定义域名和管理员授权 TCP；拒绝 UDP、访客模式、任意插件与通用命令。因此，即使控制面出现渲染错误，也不能直接把 Agent 变成开放代理。

### 撤销必须影响已有连接

只把数据库中的 `enabled` 改成 `false` 不够。策略版本变化要到达流量网关和客户端，网关需要终止活动流。WebSocket 提供实时通知，安全轮询负责断线后的最终收敛。

### 网络输入需要同时限制字节和结构

实时 WebSocket 把完整消息限制在 64 KiB，同时限制碎片数与缓冲分块。测试覆盖超限、未授权、异常断连、资源回收和重连。否则，大量小碎片仍可能绕过单纯的有效载荷思路。

### 自托管的数据安全从追加迁移开始

SQLite 迁移保持追加式，已有 `001` 到 `006` 不重写。新增测试从最早公开数据库升级，验证备份恢复后可写，并确保失败迁移事务回滚。家庭项目很难消除所有故障，但可以让失败路径明确且可重复。

### 发布声明必须小于或等于证据

Linux 双架构服务端与 Linux 客户端是 Stable；macOS headless 是 Beta；Windows x64 只有 Source/Experimental，暂无官方二进制。项目没有公开动态演示站。生产 FRP 固定为 0.70.1；受保护工作流重建 Agent 与双架构 FRPS `0.70.1-r1` 镜像，并固定经漏洞扫描、SBOM、来源证明与签名验证的摘要。

## Who it is for

适合：愿意维护一台 Linux 公网服务器、域名、DNS、防火墙和备份，希望发布 NAS、Home Assistant 或开发服务的人。

不适合：希望零运维 SaaS、匿名公共代理、任意协议转发，或需要官方 Windows 安装包的人。

## D14 context

截至 D14，Pages 独立访客为 `[verified value below 80]`。这里只陈述聚合结果，不把 GitHub Clone 当成用户增长，因为 CI checkout 会污染克隆量。下一步会先改善外部入口，并继续收集不含域名、IP 或凭据的真实部署结果。

三步启动与完整支持矩阵：

<https://zhanry.github.io/home-tunnel/?utm_source=zhihu&utm_medium=post&utm_campaign=launch_2026_08>

技术实现与源码：

<https://github.com/ZHanry/home-tunnel?utm_source=zhihu&utm_medium=post&utm_campaign=launch_2026_08>

部署反馈：

<https://github.com/ZHanry/home-tunnel/issues/new?template=deployment_feedback.yml&utm_source=zhihu&utm_medium=post&utm_campaign=launch_2026_08>

## Final review checklist

- [ ] D14 value is sourced from the archived GoatCounter snapshot.
- [ ] Every support claim matches the live README and Release.
- [ ] No Windows download or public-demo wording was introduced.
- [ ] No individual referrer or deployment detail is disclosed.
- [ ] The owner approved this exact version immediately before publication.
