# 2026-08-12 全面加固变更说明（维护交接文档）

本文档记录 2026-08-12 一轮系统性代码审查与修复的全部内容，供后续维护者（人或 AI Agent）理解改动背景、设计契约与遗留事项。改动共涉及 46 个已有文件与 2 个新增测试文件（+1852/-359 行），覆盖四个组件与部署配置。

## 一、背景

对全仓库做了一次深度代码审查（服务端 Node、Windows 客户端、Linux 客户端、部署与 CI），共确认 55 项问题并全部修复，另实施了一项跨组件安全特性（FRPS TLS 服务器身份校验）。问题集中在三类：

1. **长时间运行的边界条件**：流错误事件未监听、无界内存增长、大事务阻塞、TCP 半开连接。
2. **并发竞态**：Windows 客户端 Agent 进程监督的崩溃恢复路径。
3. **配置漂移**：两份 compose 文件的 secrets 命名与环境变量不一致。

## 二、各组件修改清单

### traffic-gateway（`traffic-gateway/src/server.ts` + `server.test.ts`）

| 问题 | 修复 |
| --- | --- |
| 【高】`request`/`response` 流无 `error` 监听，客户端 TCP 重置会使进程崩溃 | `handleRequest` 为两个流各加 `once("error", finish)`；删除已弃用的 `request.on("aborted")`；`finish()` 只在有错误时销毁上游 |
| 【高】上游 `agent: false` 无连接复用、无超时 | 模块级 `http.Agent({ keepAlive: true, maxSockets: 256 })`；HTTP 路径 `upstream.setTimeout(30s)` 只覆盖等待响应头阶段（响应到达后清除，不影响 SSE/长轮询）；升级路径的 `net.connect` 超时只覆盖连接建立阶段 |
| 【中】XFF 取最左（可伪造）元素 | 改取最右元素（由可信直连代理 Caddy 追加） |
| 【中】`SampleCollector` 上传失败时无限累积 | 上限 5000 条，超限按 `bucket_start` 丢最旧 bucket（绝不丢当前 bucket），`SAMPLE_BUFFER_OVERFLOW` 去重告警 |
| 【中】SSE `reader.read()` 无空闲超时，半开连接静默退化 | 每次 read 前 90 秒计时器，超时 abort 连接触发重连（控制中心每 30 秒发 keepalive） |
| 【中】启动时策略同步失败即崩溃 | `initialPolicySync()` 以 1s→30s 封顶退避无限重试，成功前不监听 |
| 【低】无限速连接逐块过 Promise 链 | `ThrottleTransform._transform` 同步快速路径（保留撤销检查） |
| 【低】healthz 靠 Host 白名单 | **未改**：compose 健康检查与 control-center 探活均无法带 header，改动会破坏部署，已在代码注释说明 |

### control-center（`control-center/src/`）

| 问题 | 修复 |
| --- | --- |
| 【高】维护任务/设备删除的巨型事务 + 全局互斥锁造成全站停顿 | `maintenance.ts` 每批（5000 行）独立事务、批间 `setImmediate` 让出；`admin.ts` 设备删除先在事务外分批清明细，主事务只做本体删除 + 兜底清扫 |
| 【高】WS upgrade 未知路径 socket 泄漏 | `realtime.ts` 回写 404 并 `socket.destroy()` |
| 【中】每条 SQL 每次重跑正则翻译 + 重新 prepare | `db.ts` 加语句缓存 Map（上限 500，`migrate()`/`closeDatabase()` 时清空） |
| 【中】`FixedWindowLimiter` 内存无界 | 10000 条上限 + 过期清理 + 最旧淘汰 |
| 【中】`observed_at` 字符串比较格式不一致 | 入库前 `new Date(Date.parse(v)).toISOString()` 归一化 |
| 【中】优雅停机不完整 | 5 秒强退兜底 + `closeAllConnections()` + server close 后再关 DB |
| 【中】审计 count 全表扫 | 改为 `LIMIT 10001` 子查询计数 |
| 【中】事务重入死锁风险 | `AsyncLocalStorage` 标记，事务内误用模块级 `query()` 立即抛错 |
| 【中】`PUBLIC_BASE_URL`/`TUNNEL_DOMAIN` 无生产占位符校验 | 与 `PUBLIC_FRPS_HOST` 同标准校验 |
| 【低】临时密码取模偏差 | `crypto.randomInt` |
| 【低】WS 广播无背压检查 | `bufferedAmount > 1MiB` 即 terminate |
| 【低】NewProxy 授权查询不命中索引 | compact id 还原为标准 UUID 后按主键等值查（CloseProxy 同步修复） |
| 【低】CSP `connect-src wss:` 过宽 | 收敛为 `'self'`（前端 WS 为同源） |
| 【低】死代码/重复 | 删 `revokeTokenFamily`、adminGuard 重复校验、类型体操、9 处 `public_url` 重复展开 |
| 【低】前端密码写入 DOM | `public/app.js` 改存闭包变量 |
| 【测试】默认 test 只跑 security | `pnpm test` 现在跑 security + db + public 单测 + 集成套件；新增 `src/db.test.ts`（`normalizeSql` 表驱动 15 用例 + 缓存/重入 3 用例） |

**未处理项**（明确留待后续）：`reservedSubdomains` 在 `security.ts` 与网关各维护一份、`connectionSelect` 在 client.ts/admin.ts 两份近似拷贝——属跨文件结构重构，改动收益/风险比不高。

### linux-client + 部署 + CI

| 问题 | 修复 |
| --- | --- |
| 【高】`deploy/compose.yaml` secrets 文件名与生成脚本不匹配（部署阻断） | 统一为 `frps_plugin_key`；联动修复 `deploy/scripts/install.sh` 与 `tests/run-compose-smoke.ps1` |
| 【高】两份 compose 的 FRPS 绑定/端口变量名不一致 | 统一为 `HOME_TUNNEL_FRPS_BIND_ADDRESS`/`HOME_TUNNEL_FRPS_PORT` |
| 【中】secrets 0600 + root 属主，容器 uid 10001 读不到 | 生成脚本改为文件 0644 + 目录 0700（脚本内有注释说明安全性依据） |
| 【中】控制台域名 on-demand TLS 与 control-center 故障耦合 | console 站点改常规 ACME，隧道通配站点保留 on_demand |
| 【低】Caddy 容器未 read_only | 已启用 |
| 【中】错误消息字符串匹配做控制流 | `state.ErrStateDamaged` 哨兵错误 + `errors.Is` |
| 【中】`store.Save` 失败静默 | `saveStateLogged` 辅助函数统一记日志 |
| 【中】rename 后未 fsync 父目录 | `syncDirectory`（Windows 测试环境下跳过） |
| 【中】sync/Apply 阻塞主循环致心跳假离线 | 心跳独立 goroutine（context + WaitGroup 回收，读深拷贝快照） |
| 【低】重启超限永久趴窝 | 10 分钟冷却后重置 `restartFailures` |
| 【低】杂项 | 删 `clearString` 伪安全代码、自定义 `min`、`allowHTTP` 死参数；启动清理旧 lkg 文件；SESSION_REVOKED 重登成功立即重试 sync |
| 【中】systemd 无重启退避 | 单元加 `RestartSteps=8`/`RestartMaxDelaySec=300`；主防线是 `app.go` 的 `retryTransient`（启动路径指数退避，`permanentError` 不重试） |
| 【低】沙箱补强 | `SystemCallFilter=@system-service` 等四项；install.sh 已安装检测补 `$enroll_target` |
| 【中】CI 缺口 | 加 `go vet`、shellcheck（`--severity=warning`）、deploy/compose.yaml 校验（含桩 secrets + external 网络）、版本一致性检查（model.go / .env.example / compose tag / build-release.sh 四处对照） |

### windows-client + windows-agent

| 问题 | 修复 |
| --- | --- |
| 【中】Agent 校验遗漏 `SubDomain` | 非空即拒绝 |
| 【中】Agent 黑名单遗漏 Common 字段 | 补齐 `DNSServer`（必须为空）、`NatHoleSTUNServer`、`UDPPacketSize`、`LoginFailExit`、`TCPMux`、`PoolCount`、`DialServerTimeout` 等，按 FRP `Complete()` 后的默认值比对；已核对两个客户端生成的 TOML 均不受影响 |
| 【高】`OnUnexpectedExitAsync` 竞态（双进程/暂停后复活） | 引入 `DesiredState { Stopped, Running }` 期望状态；重启动作移入 `_gate` 锁内并复查进程引用与期望状态 |
| 【高】`ApplyAsync` 探测窗口被取消产生脱管孤儿 | `Start()` 后立即登记 `_process`；取消路径先 `Kill(entireProcessTree: true)` |
| 【中】重启计数只增不减、UI 停 Degraded | 存活超 60 秒重置计数；重启成功 Report Online |
| 【中】并发同步请求被静默丢弃 | `_syncPending` 标记 + 持锁方补跑 |
| 【中】连接状态是乐观假值 | 解析 Agent 日志 `start proxy success`/`start error` 维护每条连接真实状态（`Waiting`→`Online`/`Error`），`LastErrorCode` 不再是死代码 |
| 【中】更新下载无空闲超时 | `DownloadIdleTimeout`（60 秒，CTS `CancelAfter` 每次读前重置） |
| 【中】签名指纹只展示不校验 | 配置指纹时用 `X509Certificate.CreateFromSignedFile` 校验，不匹配返回 `SignerMismatch` 拒绝启动 |
| 【中】`Dispose` 同步阻塞 UI 最长 8 秒 | 直接 Kill 进程树不等待 |
| 【低】async void 吞异常 | `RunSafely` 包装器统一兜底 |
| 【低】WS 重连对撤销无限重试 | 识别 401/SESSION_REVOKED/DEVICE_REVOKED/USER_DISABLED 即登出退出循环 |
| 【低】其余 | 日志器初始化顺序、`TogglePauseAsync` 状态回滚、`SecureDelete` 简化为 Delete+日志、连接列表启用 UI 虚拟化 |

## 三、新特性：FRPS TLS 服务器身份校验（跨组件契约）

**动机**：原先 Agent→FRPS 的 TLS 只加密不认证（FRP 无 CA 配置时 `InsecureSkipVerify`），中间人可窃取 `metadatas.home_tunnel_lease` 租约令牌并接管隧道。

**信任链**（维护时不得破坏）：

```text
部署脚本生成 10 年期自签证书（EC P-256，SAN 含 FRPS 主机名/IP）
  → frps 以 secrets 挂载 cert+key（transport.tls.certFile/keyFile）
  → control-center 挂载证书公钥部分（FRPS_TLS_CERT_FILE），
    经 HTTPS /api/v1/public/config 下发 frps_tls_certificate_pem
  → 客户端把 PEM 原样写入运行时目录 frps-ca.pem，
    生成配置加 transport.tls.trustedCaFile（绝对路径）+ transport.tls.serverName（= FRPS 主机名），
    并把「自己写入文件字节的 SHA-256 hex」经 --tls-ca-sha256 传给 Agent
  → Agent 校验 trustedCaFile 文件字节哈希与参数一致、serverName 与 --server 一致，
    再由 FRP 用该 CA 验证 FRPS 证书
```

**向后兼容规则**：服务端未配置 `FRPS_TLS_CERT_FILE` 时 `/public/config` 不含新字段；客户端无 PEM 时不写 CA、不加配置行、不传参数；Agent 无 `--tls-ca-sha256` 时保持旧校验（禁止一切自定义 TLS 文件）。修改任何一端时必须保持这条兼容链。

**涉及文件**：
- `windows-agent/main.go`（flag 与 `validateTrustedCaFile`）、`windows-agent/main_test.go`
- `control-center/src/config.ts`、`src/routes/public.ts`
- `deploy/frps/frps.toml.template`、两份 compose、`deploy/scripts/new-selfhost-config.{sh,ps1}`、`deploy/scripts/install.sh`
- `windows-client/Services/ServerProfile.cs`、`Models/Contracts.cs`、`Services/FrpcSupervisor.cs`、`MainWindow.xaml.cs`
- `linux-client/internal/model/model.go`、`internal/api/client.go`、`internal/agent/supervisor.go`（注意 `syncTrustedCa()` 在 `New()` 也调用——服务重启后 Tick 直接拉起 lkg 配置时 CA 文件必须已就绪）
- 文档：`docs/SELF_HOSTING.md`、`docs/SECURITY_MODEL.md`

## 四、构建与测试方式（本机工具链）

本仓库自带工具链（`.downloads/` 目录，勿删）：

| 工具 | 位置 |
| --- | --- |
| Go 1.23.12 | `.downloads/go-toolchain/go/bin/go.exe` |
| .NET 8 SDK | `.downloads/dotnet8/dotnet.exe` |
| FRP 0.62.1 固定源码 | `.downloads/frp-api-b41d8f8e.../fatedier-frp-*/` |
| Node 24 + pnpm 11 | 系统 PATH |

**测试命令**：

```powershell
# control-center（test 已含 security+db+public 单测与集成套件）
cd control-center; pnpm run check; pnpm run build; pnpm test; pnpm run test:public; pnpm run test:integration

# traffic-gateway
cd traffic-gateway; pnpm run check; pnpm run build; pnpm test

# linux-client
cd linux-client
& "..\.downloads\go-toolchain\go\bin\go.exe" vet ./...
& "..\.downloads\go-toolchain\go\bin\go.exe" test ./...

# windows-client（含真实 Agent 集成测试；AgentExpectedSha256 见下方遗留事项）
& ".downloads\dotnet8\dotnet.exe" run --project windows-client-tests\HomeTunnel.Client.Tests.csproj -c Release `
  -p:AgentExpectedSha256=<本地 agent 的 SHA-256>
# CI 模式（跳过 Agent 集成）：设环境变量 HOME_TUNNEL_SKIP_AGENT_TESTS=1

# windows-agent（无独立 go.mod，需复制进 FRP 源码树测试）
# 把 main.go + main_test.go 复制到 .downloads\frp-api-*\fatedier-frp-*\cmd\home-tunnel-agent\
# 在 FRP 树根运行 go vet/test/build，结束后删除该临时目录
```

本轮最终回归结果：四个组件全部通过（control-center 24 单测 + 集成、gateway 10 单测、linux-client 4 包、windows-client 87 项断言含 Agent 集成）。

## 五、遗留事项（后续维护必读）

1. **发布前必须重建 Agent 官方基线**：`windows-agent/main.go` 多次变更（校验收紧 + TLS flag + 白名单重构），本机无 windres 无法按正式流程打包。CI 现在有 `windows-agent` job 自动运行 `build-agent.ps1` 并上传官方基线 artifact（含 SHA-256），发布时取该哈希更新 `HomeTunnel.Client.csproj` 的 `AgentExpectedSha256`（及签名后的 `HomeTunnelAgentSignerThumbprint`）。本机测试用的无资源版 agent（gitignored 的 `windows-client\assets\HomeTunnel.Agent.exe`）当前 SHA-256 为 `e392cd98ec584925f4850c1d46d53a5b5c21b3ab07c8788b21a78157061f0d23`，本地跑 C# 测试时用 `-p:AgentExpectedSha256=<该值>` 覆盖。
2. **已有部署升级路径**：frps 模板新增了证书配置，现有部署必须先运行更新后的 `new-selfhost-config` 脚本生成 `deploy/secrets/frps_tls_cert.pem`/`frps_tls_key.pem`，再 `docker compose up`，否则 frps 因 secret 缺失无法启动。frps 镜像需重建（模板变更）。
3. **Agent 校验中的 FRP 版本耦合**：`validateManagedSurface`/`validateManagedProxy` 现在是白名单式——构造期望配置经 FRP `Complete()` 填充默认值后与实际配置 `reflect.DeepEqual` 全字段比对，默认拒绝。升级 FRP 版本时新增字段若带非零默认值会自动放行（两侧一致），但客户端模板与期望模板必须同步演进。
4. **升级路径慢速上传的已知权衡**：网关上游 30 秒空闲超时在限速极低（约 <17 kbps）时可能误伤单块传输，属极端配置，见 `traffic-gateway/src/server.ts` 相关注释。
5. **未做的结构性重构**：`reservedSubdomains` 双份维护、`connectionSelect` 重复、Linux 客户端自动更新与签名发布（README 路线图项）。

## 六、第二轮优化（同日完成）

在第一轮 55 项修复基础上又完成六项深度优化，全部通过回归：

1. **移除 SQL 方言翻译层**（control-center）：删除 `normalizeSql` 及 bindingIndexes 重排机制，约 100 条 SQL 分布 10 个文件全部改写为 SQLite 原生方言（匿名 `?` 占位、参数按文本顺序排列、重复引用改为重复传值）。四个自定义时间函数（`home_tunnel_now` 等）与语句缓存保留。`db.ts` 有防御断言：SQL 出现 `$数字` 立即抛错。**维护规则：新 SQL 一律写 SQLite 原生方言。**
2. **自动数据库备份**（control-center）：`src/backup.ts` 每日（`BACKUP_INTERVAL_HOURS`，0 禁用）经全局互斥执行 `VACUUM INTO` 到 `BACKUP_DIRECTORY`（默认库同目录 `backups/`），按 `BACKUP_RETENTION_COUNT`（默认 7）清理，事件码 `BACKUP_COMPLETED`/`BACKUP_FAILED`。恢复方式见 `docs/SELF_HOSTING.md` Operations 节。
3. **Prometheus 指标**：control-center `GET /internal/metrics`（`x-home-tunnel-key` 鉴权，users/devices/connections/sessions/ws 客户端/HTTP 状态类计数/备份时间戳）；traffic-gateway `GET /metrics`（同 key 鉴权，不匹配返回与业务 404 全等的响应以隐藏端点；policy revision/age、active_streams、bytes/requests/upstream_errors、throttle_wait、样本缓冲）。均为手写文本格式，零依赖。
4. **网关 e2e 测试**（`src/server.e2e.test.ts`，10 用例）：真实 HTTP 往返（头清洗断言）、错误映射、传输中撤销断流、WebSocket 帧级双向校验、客户端 RST 崩溃回归、metrics 计数增长。新增 `createGatewayServer()` 工厂（生产行为不变）；`policies`/`samples`/`syncPolicies` 已导出供测试注入。
5. **Agent 白名单校验**（见遗留事项 3）：新增 `firstDiffPath` 反射 diff 给出首个差异字段路径；CI 新增 `windows-agent` job（windows-latest + choco mingw）自动构建官方基线并上传 artifact。
6. **Linux 客户端 WebSocket 即时通知**：`internal/realtime` 标准库 RFC 6455 客户端（握手/掩码/ping-pong/close/64KiB 上限/90 秒空闲检测），`app.Run` 中独立 goroutine 连接 `/api/v1/ws`，事件触发即时同步（容量 1 信号通道合并风暴），3 分钟轮询降级为兜底；401 走一次重登，撤销类错误交主循环收尾。零第三方依赖。

## 七、维护约定

- 与既有代码风格保持一致（TS 双引号分号、Go gofmt、C# 现有命名）。
- CI 已加强：go vet、shellcheck、双 compose 校验、版本一致性检查（`2.3.0` 出现在 model.go / .env.example / compose 镜像 tag / build-release.sh 四处，改版本号要同步）、Agent 基线自动构建。
- SQL 一律写 SQLite 原生方言（`?` 占位符）；`src/db.test.ts` 守护 `$n` 残留与自定义函数语义。
- 修改 Agent 校验或客户端配置生成时，三端必须同步（windows-client `RenderConfig`、linux-client `RenderConfig` 与 Agent 的期望模板逐字段一致，任何一端加字段其余两端同步）。
- 指标端点变更时同步更新两端的 e2e/集成测试断言。
