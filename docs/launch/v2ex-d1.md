# D1 V2EX draft

## Owner review gate

- Submit only after D0 Pages and the intended stable Release are live and verified.
- Replace no facts from memory: open the live support matrix and Release assets first.
- Confirm the exact title, body, screenshots, account, node, and links immediately before posting.
- Do not describe `v2.5.0-rc.1` as stable. Do not claim an official Windows download.

## Title

Home Tunnel：给 NAS、Home Assistant 和开发服务加一个可审计的自托管入口

## Body

家里的 NAS、Home Assistant 或临时开发服务需要从外网访问时，最直接的做法往往是端口映射，或者在 FRP 上写一份长期配置。隧道能通只是第一步：谁可以创建连接、一个链接什么时候失效、撤销后已有流量是否会断开、带宽和月度用量是否受控、出了问题能否追溯，这些才是把服务长期放到公网时容易漏掉的部分。

我做了 Home Tunnel，一个面向个人与家庭服务的自托管内网穿透平台。它把控制面和业务流量分开：控制中心管理用户、设备、连接、短期租约和审计；流量网关处理 Host 授权、访问策略、限速和采样；FRPS 负责隧道传输；家庭设备上运行能力受限的 Agent。

它不是公共代理，也不是给用户开放任意 FRP 配置。Agent 只接受控制中心签发、且通过本地白名单的 HTTP/HTTPS、已验证自定义域名和管理员授权 TCP 配置；UDP、访客模式、任意插件和通用 FRP 命令都会被拒绝。生产固定使用 FRP 0.70.1；受保护工作流重建 Agent 与 FRPS `0.70.1-r1` 镜像，并固定经漏洞扫描、SBOM、来源证明和签名验证的摘要。

当前公开支持范围是：

- Linux `amd64` / `arm64` 服务端：Stable；
- Linux `amd64` / `arm64` headless 客户端：Stable；
- macOS `amd64` / `arm64` headless 客户端：Beta；
- Windows 10/11 x64：仅源码、Experimental，暂无官方二进制和更新清单。

项目不提供公开动态演示站，也不会让陌生人操作真实控制台。网站上的管理后台和移动端截图来自当前前端代码与 UI Preview，使用的是本地夹具数据。

部署需要一台有公网地址的 Linux 服务器、一个域名，以及控制台和通配符 DNS。基本流程是生成自托管配置、校验 Compose、启动容器，然后使用一次性管理员密码登录并立即改密。完整 DNS、防火墙、备份和回滚步骤放在文档里，没有把生产凭据塞进一条复制粘贴命令。

这轮也补了工程证据：WebSocket 完整消息限制为 64 KiB，并限制碎片数与缓冲分块；测试覆盖超限、异常断连、资源回收和重连。CI 覆盖 TypeScript、Go、.NET、契约、Compose、依赖审计和文档检查；稳定发布要求同一提交的校验和、SBOM、provenance 与签名证据。

项目主页与三步启动：

<https://zhanry.github.io/home-tunnel/?utm_source=v2ex&utm_medium=post&utm_campaign=launch_2026_08>

源码与 Issue：

<https://github.com/ZHanry/home-tunnel?utm_source=v2ex&utm_medium=post&utm_campaign=launch_2026_08>

如果你愿意实际部署，我最想收集的是“什么平台、是否安装成功、卡在哪里”。反馈不需要域名、IP、凭据、证书或私密日志：

<https://github.com/ZHanry/home-tunnel/issues/new?template=deployment_feedback.yml&utm_source=v2ex&utm_medium=post&utm_campaign=launch_2026_08>

也欢迎直接指出文档中不清楚或不可信的地方。安全漏洞请不要公开发 Issue，使用仓库的私密漏洞报告入口。

## First reply if needed

补充一个明确边界：历史 Release 中可能仍能看到自签名 Windows 资产，它们只为追溯保留，属于旧版、不受支持、未知发布者构建，不代表当前提供 Windows 安装包。
