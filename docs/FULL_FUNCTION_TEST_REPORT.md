# Home Tunnel 2.3.0 全功能测试报告

测试时间：2026-08-12（UTC+08:00）
代码基线：`main` / `d3ce814` 加当前工作区的 Linux 客户端与 UI 优化改动
测试主机：Windows x64；浏览器验证使用本地 UI Preview；Linux 验证使用 WSL Ubuntu

## 1. 结论

本轮 UI 优化和可在本机执行的功能回归通过。控制中心、流量网关、Windows 客户端和 Linux 客户端均能完成编译或测试；Web 首页、登录、五个后台页面、移动端布局和连接表单已通过实际浏览器检查。

当前结果可以作为部署候选版本继续验证，但不能据此宣称“真实公网生产链路全部通过”。本机 Windows 环境没有 .NET SDK、Inno Setup、SignTool 和 `windres`；WSL 具有 Docker CLI 并通过了 Compose 配置解析，但没有启动完整容器栈。因此真实 Caddy/FRPS/TLS、Windows 安装包与签名流程未在本轮执行；Linux systemd 安装也没有写入测试机系统目录。

状态说明：

- **通过**：本轮已执行并得到预期结果。
- **部分通过**：核心逻辑通过，但依赖的真实运行环境或发布产物不完整。
- **未执行**：本机缺少依赖，或执行会改动非隔离系统环境。

## 2. UI 设计与实现验收

设计由 Gemini CLI 0.53.0 在只读 `plan` 模式下完成，Codex 根据仓库真实能力做了实现和安全校正。没有采用 Gemini 提议的虚构 Linux GUI，也没有加入项目并未提供的一键远程安装脚本。

| 验收项 | 状态 | 结果 |
| --- | --- | --- |
| Web / WPF 统一视觉语言 | 通过 | 统一为深蓝、青绿色数据强调、Slate 中性色和一致状态色；地址与 ID 使用等宽字体。 |
| 首页双平台表达 | 通过 | Windows 明确为图形客户端；Linux 明确为 amd64/arm64 systemd 无界面服务，并列出真实安装命令摘要和限制。 |
| 后台系统健康 | 通过 | 总览调用 `/api/v1/admin/system/health`，展示控制中心、SQLite、策略队列、网关、FRPS、Caddy、备份等实际返回组件。 |
| 设备配置漂移 | 通过 | 设备列表显示客户端/Agent 版本及“应用版本 / 目标版本”，区分“已同步 / 待应用”。不依据名称猜测设备操作系统。 |
| 390px 移动端密度 | 通过 | 四项指标改为 2×2；表格卡片行高和内边距缩小；系统健康组件自动换行；无横向溢出。 |
| WPF 高 DPI / 小工作区 | 通过 | 保留 PerMonitorV2、布局取整和自动化属性；主窗体与连接对话框改为可缩放，并按工作区限制初始尺寸。 |
| 状态完整性 | 通过 | 保留加载骨架、空状态、错误、离线/降级、会话撤销、忙碌遮罩及破坏性确认。 |

## 3. Web 功能与浏览器验证

本地地址：`http://127.0.0.1:4175/`，使用 `control-center/scripts/ui-preview.mjs` 的隔离数据。

| 场景 | 视口 | 状态 | 证据 |
| --- | --- | --- | --- |
| 产品首页与 Windows 下载元数据 | 桌面 | 通过 | 最新版本、x64、大小和 SHA-256 正常加载。 |
| Linux 服务版入口 | 桌面 / 390×844 | 通过 | 可见 systemd/Headless 定位、amd64/arm64、安装摘要、3 分钟同步和无自动更新说明。 |
| 后台总览 | 桌面 / 390×844 | 通过 | 指标、系统组件健康、流量表均正常渲染。 |
| 用户、设备、连接、审计页面导航 | 390×844 | 通过 | 五个页面逐一导航，页面标题与请求目标一致。 |
| 设备在线/离线及配置漂移 | 390×844 | 通过 | 在线设备显示“已同步 v12/v12”；离线设备显示“待应用 v4/v5”。 |
| 创建连接对话框 | 390×844 | 通过 | Dialog 语义、用户/设备联动、HTTP/HTTPS、地址、端口、限速和启用字段均可见；底部操作固定可达。未提交数据。 |
| 退出与登录页 | 390×844 | 通过 | 退出后显示登录卡片、用户名/密码标签、显示密码按钮、状态提示和首页返回入口。 |
| 响应式横向溢出 | 390×844 | 通过 | 首页和后台 `scrollWidth - clientWidth = 0`。 |
| DOM 基础可访问性 | 390×844 | 通过 | 首页和后台均无重复 ID；可见 input/select/textarea/button 无缺失可访问名称。 |
| 浏览器运行时日志 | 全流程 | 通过 | 页面 `error` / `warning` 控制台日志为 0。 |

说明：以上浏览器检查覆盖实际 DOM、CSS 和交互，但不是基于真实数据库的浏览器端到端。真实认证、SQLite 和权限逻辑由后面的控制中心集成测试覆盖。

## 4. 控制中心与网关

环境：Node.js 24.16.0、pnpm 11.16.0。项目要求 Node.js 22 或更高，本机版本在支持范围内。

| 命令 / 套件 | 状态 | 结果 |
| --- | --- | --- |
| `control-center: pnpm run check` | 通过 | TypeScript 无类型错误。 |
| `control-center: pnpm run build` | 通过 | 编译成功。 |
| `control-center: pnpm run test` | 通过 | 5/5：Argon2id、工作队列、密码/子域策略、签名租约、限流。 |
| `control-center: pnpm run test:public` | 通过 | 1/1：公开首页、双平台文案、版本化静态资源、公开配置与 GitHub 下载元数据。 |
| `control-center: pnpm run test:integration` | 通过 | `SQLITE_INTEGRATION=passed`；覆盖管理员/用户认证、Linux token、设备注册、连接、策略、SSE、版本冲突和 FRPS 插件。 |
| `traffic-gateway: pnpm run check/build/test` | 通过 | 6/6：Host 授权、策略撤销、租约到期、共享限速、样本重试和陈旧桶替换。 |
| `node --check` UI 脚本 | 通过 | `app.js` 与 `ui-preview.mjs` 语法正确。 |

## 5. Windows 客户端

本节记录同批 UI 改动早前在 .NET SDK 8.0.423 环境完成的结果；最终 `v2.3.0` 版本号更新后，本机当前 shell 已无法找到 .NET SDK，因此 Windows 版本号后的重新编译由 GitHub CI 承担。

| 场景 | 状态 | 结果 |
| --- | --- | --- |
| `HomeTunnel.Client.Tests` Release | 部分通过 | 57 项更新、发现、URL、下载和状态逻辑检查通过。由于工作区没有受管 Agent EXE，按 CI 约定设置 `HOME_TUNNEL_SKIP_AGENT_TESTS=1`。 |
| WPF Debug 编译 | 通过 | 0 警告、0 错误；`HomeTunnel.dll` 生成成功。 |
| QA 主界面启动 | 部分通过 | `HOME_TUNNEL_UI_QA=1`、`HOME_TUNNEL_UI_QA_VIEW=main` 可启动，系统返回唯一标题为 `Home Tunnel` 的窗口。Computer Use 截图阶段返回 `node_repl exec context not found`，因此没有将桌面截图计为通过证据。 |
| XAML 契约 | 通过 | 原有 `x:Name`、事件处理器、AutomationProperties、LiveSetting、默认/取消按钮保持；编译器完成 XAML 校验。 |
| Windows Agent 源码构建 | 未执行 | 缺少 `windres.exe`。 |
| EXE/MSIX 安装、升级、卸载和签名 | 未执行 | 缺少 Inno Setup、Windows SDK SignTool 和签名证书。 |

## 6. Linux 无界面客户端

环境：WSL Linux/amd64，Go 1.26.0；GitHub CI 固定使用 Go 1.23.12。

| 场景 | 状态 | 结果 |
| --- | --- | --- |
| WSL `go test -race ./...` | 通过 | Linux/amd64 竞态检测通过。 |
| WSL 静态构建 | 通过 | `CGO_ENABLED=0 go build ./cmd/home-tunnel-client` 成功；临时产物由 `.gitignore` 排除。 |
| amd64 发布包运行自检 | 通过 | Client 报告 `2.3.0 (Agent 2.3.0)`；Agent 报告 FRP 0.62.1 和固定 commit。 |
| arm64 包结构 | 通过 | 包含 client、受限 Agent、安装器、enroll helper、systemd unit 和 README。 |
| 发布包 SHA-256 | 通过 | amd64 与 arm64 `.sha256` 均由 Linux `sha256sum -c` 验证。 |
| 真实 systemd 安装/升级/租约过期 | 未执行 | 不在用户的 WSL 系统目录写入服务和凭据；需要隔离 Ubuntu VM 或 CI runner。 |
| arm64 运行时 | 未执行 | 当前主机没有 arm64 Linux 执行环境或 QEMU。 |

发布包：

- `home-tunnel-linux-2.3.0-amd64.tar.gz`：`fbac69317b67f2b1aa47113716ca26e7d398d54cc97ac1a1b5754e273078e812`
- `home-tunnel-linux-2.3.0-arm64.tar.gz`：`e7e422139e450df8f3f47318d99c1000205aeac4f95e13445c63957d5ee29459`

## 7. 视觉与可访问性

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| 键盘焦点 | 通过（静态/浏览器） | Web `:focus-visible` 3px；WPF 全局 FocusVisualStyle 3px。浏览器表单焦点可见。 |
| 触控目标 | 通过（静态） | 主要按钮、输入和图标按钮保持 44px 最小高度/尺寸。 |
| Reduced Motion | 通过（静态） | Web 保留 `prefers-reduced-motion`；动画与过渡降至 0.01ms。 |
| 文本对比度 | 通过 | 白/主蓝 7.15:1、Ink/白 17.85:1、正文/白 10.35:1、Muted/白 4.76:1、成功/浅绿 5.21:1、警告/浅黄 4.84:1、危险/浅红 5.91:1。 |
| 完整 WCAG / axe 扫描 | 未执行 | 仓库尚未引入 axe 或 Playwright 测试依赖；当前证据为语义树、标签、焦点、溢出和颜色计算。 |

## 8. 未覆盖风险与部署前必做项

1. 已在 WSL 完成两套 Compose 文件的配置解析；仍需在具有完整 Docker Engine 的 Linux/Windows 主机运行 `tests/run-compose-smoke.ps1`，保存四个服务的健康检查与日志。
2. 配置真实 DNS、Caddy on-demand TLS 和独立 FRPS 7000/TCP，验证公网 HTTPS、WebSocket、策略撤销和租约过期后的连接中断。
3. 在干净 Windows 10/11 VM 构建受管 Agent、EXE/MSIX，执行安装、升级、修复、托盘、开机启动、签名和卸载测试。
4. 在隔离 Ubuntu amd64 VM 与 arm64 runner 执行 `install.sh`、`home-tunnel-enroll`、systemd 权限、重启恢复、3 分钟同步、心跳、Agent 崩溃重启和租约过期测试。
5. 管理 API 当前没有持久化客户端操作系统字段。后台只展示可信的 client/agent 版本和配置漂移，后续如需 Windows/Linux 筛选，应新增经过服务端校验的 `client_platform` 字段，不能通过设备名称猜测。
6. 增加 Playwright + axe 浏览器端到端，并将 390px、768px、1280px 截图作为 CI 产物，避免后续视觉回归。

## 9. 部署判断

- **开发/家庭实验部署：可以继续部署验证。** 当前服务端逻辑、Web 管理、Windows WPF 编译和 Linux 客户端核心流程均通过。
- **无人值守生产部署：有条件通过。** 必须先完成第 8 节的 Compose、公网 TLS、Windows 签名安装器和真实 systemd 测试，尤其不能跳过凭据权限、租约过期和策略撤销验证。
