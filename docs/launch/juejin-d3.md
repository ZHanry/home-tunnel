# D3 Juejin technical article draft

## Owner review gate

Publish only after the owner has checked the live Release, diagrams, support matrix, title, body, tags, cover, account, and links. Where this draft says a stable Release provides evidence, verify that the exact live stable Release actually contains it. If only an RC exists, label it RC and rewrite the sentence before publishing.

## Title

从裸 FRP 到可审计的家庭内网穿透：我给控制面补了哪些安全边界

## Article

当 NAS、Home Assistant 或开发服务第一次通过隧道在外网打开时，“能访问”很容易被当成任务完成。但一个长期运行的家庭入口还要回答更多问题：谁有权创建连接？设备被撤销后，已经建立的流量会不会继续？一个用户能占用多少连接和带宽？配置更新如何及时到达客户端？数据库损坏后能否验证备份并回滚？

Home Tunnel 是我围绕这些问题做的自托管内网穿透平台。它不是 FRP 的通用配置面板，也不是公共代理。目标是让个人与家庭服务有一个可审计、可限速、可随时撤销的控制面。

项目主页和当前支持矩阵：

<https://zhanry.github.io/home-tunnel/?utm_source=juejin&utm_medium=post&utm_campaign=launch_2026_08>

### 1. 先画清楚信任边界

系统分为四个主要边界：

1. 公网边缘：Caddy 是唯一 Web 入口，负责 TLS 与到控制中心、流量网关的路由。
2. 控制面：控制中心管理用户、设备、连接、租约、审计与 SQLite 状态。
3. 业务流量面：流量网关依据 Host、访问策略、限速和配额决定请求能否进入隧道。
4. 家庭设备：能力受限的 Agent 接收控制中心渲染的配置，再启动受管 FRP 客户端。

控制流与业务流量分离。控制中心和 SQLite 默认不发布主机端口；容器使用只读文件系统、非 root 用户和最小能力集。项目不提供公开动态演示站，因为一个可操作的真实控制台会扩大攻击面，也会制造与普通部署不同的特殊环境。

Agent 是重要的第二道边界。即使控制中心渲染出错误配置，本地仍会拒绝通用 FRP 命令、UDP、访客模式、任意插件和未授权字段，只接受已签发的 HTTP/HTTPS、验证过的自定义域名和管理员授权 TCP 端口。

生产固定使用 FRP 0.70.1。升级不是只改版本号：Agent 已适配新的受管配置源与安全策略 API，FRPS `0.70.1-r1` 镜像使用 Go 1.26.6 在受保护工作流中完成双架构构建、漏洞扫描、SBOM、来源证明和无密钥签名，部署再固定其不可变摘要。

### 2. WebSocket：只限制字节数还不够

实时通道用于把配置变化推送给客户端。最明显的防护是限制完整消息大小，但仅有 `maxPayload` 仍无法覆盖结构型资源耗尽：攻击者可能用大量很小的碎片拼一条消息，或者让接收端积累过多缓冲分块。

当前实现把完整消息上限设为 64 KiB，同时限制碎片数量与缓冲分块，并关闭不需要的消息压缩。回归测试不只验证“超大消息被拒绝”，还覆盖：

- 正常分片能够重组；
- 完整消息超过上限时关闭连接；
- 碎片数或缓冲分块超过上限时关闭连接；
- 未授权握手和错误端点失败；
- 传输异常断开后连接计数和资源被回收；
- 重连后待发送事件可以继续交付。

这里的经验是：为网络输入写门禁时，既要限制总量，也要限制组成总量的结构数量，并验证失败后的资源生命周期。

### 3. 短期租约、撤销与活动流终止

长期静态配置最大的问题，是“撤销”经常只影响下一次连接。Home Tunnel 把连接能力表达为短期租约，并在控制面维护策略版本。设备、连接或用户状态改变时，客户端通过 WebSocket 收到通知；即使实时链路丢失，也保留安全轮询作为收敛路径。

流量网关不会只在进站瞬间缓存一次决定。策略版本变化会触发重新同步，撤销路径会关闭活动流。这样，“UI 显示已禁用”与“真实流量已经停止”才是同一件事。

### 4. 访问门禁、分层限速与流量桶

隧道本身不是授权。业务请求先经过 Host 解析和连接查找，然后再执行 IP 允许集、Basic Auth 等访问策略。连接级、用户级和全局级限制分别约束局部突发与整体资源，避免一个连接绕过系统总量限制。

流量统计使用聚合桶，而不是把每个数据包写进数据库。采样模块把读写字节合并成有界时间窗口，再更新连接和月度配额。模块化拆分后，策略、访问控制、限速、采样、代理与服务器生命周期分别可测试，同时保留现有依赖注入点和协议行为。

### 5. SQLite 迁移、备份与失败回滚

对自托管项目来说，SQLite 是降低运维门槛的合理选择，但“单文件”不等于“不需要迁移纪律”。已有迁移 `001` 到 `006` 保持不变，新变化只追加。`007` 引入迁移校验记录，并补了三类测试：

- 从最早公开数据库逐步升级到当前版本；
- 备份恢复后数据库可写且结构完整；
- 新迁移失败时事务回滚，不留下半迁移状态。

备份流程需要验证产物，而不是只看复制命令返回零。恢复前先保留当前文件，恢复后执行完整性检查和迁移检查；失败时再回到原状态。对家庭部署，这种保守路径通常比追求复杂高可用更实际。

### 6. 发布证据应来自同一套产物

发布链把 RC 与 Stable 分开：`vX.Y.Z-rc.N` 只能生成 prerelease，`latest` 只允许指向通过完整矩阵的稳定版。稳定镜像和资产必须来自同一提交和同一套已验证产物。

发布证据包括 SHA-256、SPDX SBOM、GitHub provenance 和无密钥签名。Linux `amd64`/`arm64` 服务端和客户端是 Stable 范围；macOS headless 是 Beta。Windows 10/11 x64 当前只有 Source/Experimental，不提供官方二进制，也不生成 Windows 专用 `latest.json`。历史自签名 Windows 资产仅作追溯，属于旧版、不受支持、未知发布者构建。

在引用这些证据前，仍应打开具体 Release 核对资产。工作流描述的能力不能替代一次实际成功的发布。

### 7. 兼容性比目录整洁更重要

这次把控制中心路由拆成用户、设备、连接、健康和审计模块，把网关拆成策略、访问、限速、采样、代理和生命周期模块，也把浏览器大脚本拆成原生 ES Modules。但 `/api/v1` 路径、JSON 字段、WebSocket 事件、Compose 环境变量和客户端发现流程没有改变。

跨组件契约夹具同时由 TypeScript 和 Go 测试消费，用来锁定保留字、配置渲染和 REST/WS 消息。它比为了共享几行运行时代码去扩大 Docker 构建上下文更容易审计。

### 8. 当前限制与我想验证的事

Home Tunnel 仍处在需要真实部署验证的阶段。它没有公开动态演示；macOS 是 Beta；Windows 是仅源码 Experimental；生产 FRP 为 0.70.1。它更适合愿意维护 Linux 服务器、域名、DNS 与备份的人，不适合希望零运维 SaaS、匿名公共代理或任意协议转发的人。

未来 30 天，我想验证的不是克隆次数。CI checkout 会污染 GitHub Clone，因此目标使用 Pages 独立访客、Stars 与非维护者的有效部署结果。有效反馈只需要真实平台、安装结果和阻碍，不要求域名、IP、凭据或私密日志。

部署反馈：

<https://github.com/ZHanry/home-tunnel/issues/new?template=deployment_feedback.yml&utm_source=juejin&utm_medium=post&utm_campaign=launch_2026_08>

完整安全模型：

<https://github.com/ZHanry/home-tunnel/blob/main/docs/SECURITY_MODEL.md?utm_source=juejin&utm_medium=post&utm_campaign=launch_2026_08>

如果你正在维护 NAS、Home Assistant 或自己的开发服务，我更想知道你在哪一步卡住，而不是听到一句“看起来不错”。这些失败路径会直接决定下一轮工程优先级。

## Suggested tags

`内网穿透`、`自托管`、`Docker`、`网络安全`、`FRP`
