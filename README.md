<div align="center">
  <img src="control-center/public/HomeTunnel.svg" alt="Home Tunnel" width="92" height="92">
  <h1>Home Tunnel</h1>
  <p><strong>面向个人与家庭服务的自托管内网穿透平台</strong></p>
  <p>Self-hosted tunnels for home services</p>
  <p>
    <a href="https://github.com/ZHanry/home-tunnel/actions/workflows/ci.yml"><img src="https://github.com/ZHanry/home-tunnel/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://github.com/ZHanry/home-tunnel/actions/workflows/codeql.yml"><img src="https://github.com/ZHanry/home-tunnel/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0 license"></a>
  </p>
  <p><a href="https://zhanry.github.io/home-tunnel/">项目网站</a> · <a href="README.en.md">English</a> · <a href="docs/SELF_HOSTING.md">自托管指南</a> · <a href="SECURITY.md">安全报告</a></p>
</div>

Home Tunnel 是面向个人与家庭服务的自托管内网穿透平台，用可审计、可随时撤销的控制面，安全发布 Web 服务、通用 TCP 字节流与固定端口 UDP 服务。

![Home Tunnel 真实管理后台，显示连接、流量和组件健康状态](docs/site/assets/admin-dashboard.jpg)

> `v3.2.0` 由 `v3.2.0-rc.3` 的同一提交和同一套不可变资产提升。服务端 Linux `amd64`/`arm64` 与 Linux 客户端为 Stable；macOS headless 为 Beta；Windows x64 EXE 与 Android 8.0+ `arm64-v8a` 客户端为 Experimental。

## 三步启动

开始前需要一台具有公网地址的 Linux 服务器、一个域名，以及指向服务器的控制台与通配符 DNS 记录。

1. 克隆仓库并生成本地配置：

   ```sh
   git clone https://github.com/ZHanry/home-tunnel.git
   cd home-tunnel
   sh ./deploy/scripts/new-selfhost-config.sh \
     tunnel.example.com \
     203.0.113.10 \
     console.tunnel.example.com \
     admin@example.com
   ```

2. 校验并启动：

   ```sh
   docker compose config --quiet
   docker compose pull
   docker compose up -d
   docker compose ps
   ```

3. 读取一次性管理员密码，访问 `https://console.tunnel.example.com/admin` 并立即改密：

   ```sh
   cat deploy/secrets/bootstrap_admin_password
   ```

完整 DNS、防火墙、备份、回滚与客户端说明见 [自托管指南](docs/SELF_HOSTING.md)。不要将示例域名、示例 IP 或任何 `CHANGE_ME` 值用于公网部署。若要从源码构建镜像，使用 `docker compose -f compose.yaml -f compose.build.yaml up -d --build`。

## 公开支持矩阵

| 组件 | 平台 | 状态 | 分发与限制 |
| --- | --- | --- | --- |
| 服务端 | Linux `amd64` / `arm64` | Stable | 容器与源码构建；稳定版要求完整双架构矩阵 |
| Headless 客户端 | Linux `amd64` / `arm64` | Stable | systemd 服务，实时配置与安全轮询 |
| Headless 客户端 | macOS `amd64` / `arm64` | Beta | launchd 包；仍需扩大真实硬件验证 |
| 图形客户端 | Windows 10/11 x64 | Experimental | Release 提供自签名 EXE 与更新清单；Windows 会提示未知发布者 |
| 移动客户端 | Android 8.0+ `arm64-v8a` | Experimental | GitHub Release 侧载 APK；AAB 不可直接安装，也不代表 Play-ready |

Windows EXE、Android APK/AAB 与其他平台资产来自同一个 RC 构建并随 Stable 原样提升，包含 SHA-256、SPDX SBOM、Sigstore 和 GitHub provenance。

GitHub Release 标签是 `v3.2.0`。Stable 不重建产物，因此 Linux/macOS 压缩包和 compose 镜像标签仍为 `3.2.0-rc.3`；Windows/Android 安装包文件名已是 `3.2.0`。下载 Linux/macOS 客户端时请使用带 `3.2.0-rc.3` 的文件名，并核对其 SHA-256。
Windows 自签名只能证明同一资产集内的完整性，不能建立可信发布者身份；Android 使用必须长期保留的固定发布证书，升级前必须保持 application ID 与证书一致。

## 为什么不是“裸 FRP”

- **能力受限的 Agent**：只接受控制中心签发且与服务器配置一致的 HTTP/HTTPS、自定义域名，以及管理员逐端口授权的 TCP/UDP 连接；拒绝通用 FRP 命令和未签发配置。
- **集中策略**：用户、设备、连接、短期租约与运行状态统一管理；Web 策略直接收敛，FRPS `Ping` 在约 90 秒心跳窗口内让 TCP/UDP 撤销失效。
- **自动 HTTPS**：Caddy 是唯一公网 Web 入口，按已分配且验证的域名签发证书。
- **Web 访问与流量控制**：HTTP/HTTPS 路径提供 IP 允许集、Basic Auth、分层限速、流量聚合和月度配额。
- **可审计运维**：审计事件、组件健康、备份验证、恢复与回滚工具。
- **默认隔离**：SQLite、控制中心和网关不直接发布主机端口；容器使用只读文件系统和最小能力集。

## 工作方式

```text
远程浏览器 ─HTTPS→ Caddy ─→ 流量网关 ─→ FRPS ═受管隧道═→ 家中 Windows/Linux/macOS/Android 主机
远程 TCP/UDP 客户端 ─已分配公网端口→ FRPS ═受管隧道═→ 家中固定 TCP/UDP 端口
管理员     ─HTTPS→ Caddy ─→ 控制中心 ─→ SQLite
Windows/Linux/macOS/Android 客户端 ─REST + WebSocket→ 控制中心
```

控制流和业务流量分离；详细边界见 [架构说明](docs/ARCHITECTURE.md) 与 [安全模型](docs/SECURITY_MODEL.md)。项目不提供公开动态演示站，Pages 中的截图由当前 UI Preview 和真实前端代码生成，示例域名与数据均为本地夹具。

## 通用 TCP、固定端口 UDP 与 RTSP

Home Tunnel 的“类型”是受管传输类型，不是应用协议清单：

| 类型 | 用途 | 公网路径 |
| --- | --- | --- |
| HTTP/HTTPS | Web 应用与 HTTPS 本地目标 | Caddy → 流量网关 → FRPS |
| TCP | RTSP-over-TCP、SSH、RDP、MQTT、数据库及其他 TCP 字节流 | 公网固定端口 → FRPS |
| UDP | DNS、游戏或媒体使用的固定 UDP 端口 | 公网固定端口 → FRPS |

RTSP 不是独立隧道类型。若摄像头在本地 `554/tcp` 提供 RTSP，可由管理员创建通用 TCP 映射“公网 `10554` → 本地摄像头 `554`”，然后强制播放器使用 TCP：

```sh
ffplay -rtsp_transport tcp rtsp://PUBLIC_HOST:10554/path
```

若设备使用原生 RTP/RTCP over UDP，必须先把摄像头配置为固定媒体端口，再为每个 UDP 端口逐条创建映射；动态协商或随机选择的媒体端口无法保证穿透。项目不支持 raw IP、ICMP、广播、组播、STCP、XTCP、SUDP、visitor 或任意 FRP 插件。

TCP 与 UDP 默认关闭，只能由管理员在允许范围内分配精确公网端口，并要求目标应用自己提供认证与加密。它们绕过 Caddy 和流量网关，因此不具备网关的 Basic Auth、IP 允许集、限速、流量计量或月度配额。UDP 还必须在主机/云防火墙限源、限速，并评估反射放大风险。启用方式见 [自托管指南](docs/SELF_HOSTING.md)。

## 客户端

### Linux / macOS

Linux Stable 客户端以 systemd 服务运行；macOS Beta 客户端以 launchd 服务运行。两者通过 WebSocket 接收实时配置通知并保留三分钟安全轮询。构建、安装与注册说明见 [linux-client/README.md](linux-client/README.md)。

### Windows x64（Experimental EXE）

从 [最新 Release 下载 Windows x64 EXE](https://github.com/ZHanry/home-tunnel/releases/latest/download/HomeTunnel-Setup-3.2.0-x64.exe)。客户端支持图形化登录、连接管理、系统托盘、自动启动和诊断导出。安装前请核对 Release 中的 SHA-256；自签名版本会触发未知发布者或 SmartScreen 提示。

也可以在 Windows 上自行构建：

```powershell
.\windows-client\packaging\build-exe.ps1 `
  -AppId "{{11111111-2222-3333-4444-555555555555}}"
```

开发打包脚本生成的自签名证书不能替代可信发布者签名；分叉仓库不得把它描述为受信任签名。

### Android 8.0+ arm64（Experimental）

从最新 GitHub Release 下载 `HomeTunnel-Android-3.2.0-arm64-v8a.apk`，核对
`SHA256SUMS.txt`、APK 签名证书 SHA-256 与 Sigstore 证据后侧载。应用 ID
为 `io.github.zhanry.hometunnel`。同一 Release 的 AAB 仅供审计或未来商店
上传，不能直接安装，也不表示已满足 Google Play 要求。Android 前台服务
通知、省电策略和 OEM 后台限制可能影响长期隧道可靠性；首版因此保持
Experimental，并且只声明 HTTP 支持，不会启动已分配的 TCP/UDP 记录。
构建与使用限制见 [Android 客户端说明](android-client/README.md)。

## 安全证据

- 控制中心 WebSocket 完整消息上限为 64 KiB，并限制碎片数和缓冲分块；回归覆盖超限、鉴权失败、异常断连、资源回收与重连。
- CI 对生产依赖执行 Moderate 以上审计，并运行 TypeScript、Go、.NET、Compose、契约与文档检查。
- CodeQL 显式分析 JavaScript/TypeScript、Go、C# 与 Android Java/Kotlin；Secret Scanning 与 Push Protection 应始终保持启用。
- Stable 发布要求同一提交和同一套已验证产物，包含哈希、SBOM、provenance 与签名证据；Windows EXE 还必须通过安装、版本、自签名一致性和卸载验证，Android APK/AAB 必须通过包名、版本、ABI 与长期证书一致性验证。

不要在公开 Issue 中提交漏洞细节、域名、IP、令牌、密码或日志中的私密信息。请使用 [GitHub 私密漏洞报告](https://github.com/ZHanry/home-tunnel/security/advisories/new)；详细政策见 [SECURITY.md](SECURITY.md)。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `control-center/` | REST/WebSocket API、管理后台、FRPS 授权插件 |
| `traffic-gateway/` | Host 授权、反向代理、访问控制、限速与采样 |
| `windows-client/` | Windows WPF 源码与本地打包脚本 |
| `linux-client/` | Linux/macOS headless 客户端及 systemd/launchd 包 |
| `android-client/` | Android 8.0+ 原生客户端、嵌入式 Agent 与 Gradle 构建 |
| `windows-agent/` | 能力受限的 FRP Agent 源码与第三方许可 |
| `contracts/` | 跨组件保留字、配置与协议契约夹具 |
| `deploy/` | Caddy、FRPS、配置、发布、备份和回滚工具 |
| `tests/` | Compose、契约、安装包与端到端验证 |
| `docs/` | 架构、安全、发布、真实截图与静态 Pages |

## 本地验证

要求 Node.js 24 LTS、pnpm、Go 1.26、.NET 10 SDK、JDK 17、Android SDK/NDK、Docker Compose，以及重建 Windows Agent 时使用的 `windres`。实际命令以 [CONTRIBUTING.md](CONTRIBUTING.md) 和 CI 为准。

```powershell
Set-Location control-center
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm test

Set-Location ..\traffic-gateway
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm test

Set-Location ..
dotnet test .\windows-client-tests\HomeTunnel.Client.Tests.csproj -c Release
```

```sh
cd linux-client
go test -race ./...
go vet ./...
go build ./cmd/home-tunnel-client
```

## 贡献与反馈

小而聚焦、带测试且说明安全影响的 PR 最容易审核。开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，发布流程见 [docs/RELEASING.md](docs/RELEASING.md)。真实部署结果请使用 [部署反馈表单](https://github.com/ZHanry/home-tunnel/issues/new?template=deployment_feedback.yml)，不要求公开域名、IP 或凭据。

## 许可证

Home Tunnel 使用 [Apache License 2.0](LICENSE)。内置 Agent 基于 FRP，许可证与第三方声明见 `windows-agent/FRP-LICENSE.txt` 和 `windows-agent/THIRD-PARTY-NOTICES.txt`。
