<div align="center">
  <img src="control-center/public/HomeTunnel.svg" alt="Home Tunnel" width="92" height="92">
  <h1>Home Tunnel</h1>
  <p>面向个人与家庭场景的自托管内网穿透平台</p>
  <p><a href="https://github.com/ZHanry/home-tunnel/actions/workflows/ci.yml"><img src="https://github.com/ZHanry/home-tunnel/actions/workflows/ci.yml/badge.svg" alt="CI"></a></p>
</div>

Home Tunnel 把 FRP、自动 HTTPS、访问策略、管理后台、Windows 图形客户端和 Linux/macOS 无界面服务组合成一套完整工具。它适合安全发布 NAS、Home Assistant、开发预览等私网 HTTP/HTTPS 服务，也支持经管理员显式开启、固定端口分配的高级 TCP 隧道，同时保留可审计、可限速、可立即停止的集中控制。

> 当前版本为 `2.4.0`。服务端默认提供 `amd64`/`arm64` 预构建镜像，也保留源码构建方式；客户端包括 Windows 10/11 x64 图形版，以及 Linux/macOS `amd64`/`arm64` 无界面服务版。客户端不内置任何运营者域名或 IP，首次注册时由用户填写自己的控制中心 HTTPS 地址。

## 为什么使用 Home Tunnel

- **Windows 友好**：图形化登录、连接管理、系统托盘、自动启动、诊断导出和安全更新。
- **Linux 服务化**：无界面设备注册、systemd 常驻、租约续签、心跳和 Agent 崩溃恢复。
- **macOS 服务化**：同一无界面客户端提供 darwin `amd64`/`arm64` 包和 launchd 常驻服务。
- **自动 HTTPS**：Caddy 作为唯一公网 Web 入口，按已分配域名签发证书。
- **能力受限的 Agent**：基于固定 FRP 0.62.1 源码构建，只接受与用户所选服务器一致的 Home Tunnel HTTP 隧道配置。
- **集中策略**：用户、设备、连接、带宽和租约状态统一管理。
- **默认隔离**：SQLite、控制中心和网关不直接发布主机端口；容器采用只读文件系统和最小能力集。
- **可运维**：健康检查、审计事件、流量聚合、备份与回滚工具，以及版本化发布元数据。

参考部署现在只有 Caddy、控制中心、流量网关和 FRPS 四个容器，控制数据保存在单个 SQLite 文件中。空闲状态不再每秒轮询策略；变更通过推送触发同步。建议准备 1 GiB 内存（低配机同时启用 swap）与 2 GiB 可用磁盘。

## 工作方式

```text
远程浏览器 ─HTTPS→ Caddy ─→ 流量网关 ─→ FRPS ═受管隧道═→ 家中 Windows/Linux/macOS 主机
管理员     ─HTTPS→ Caddy ─→ 控制中心 ─→ SQLite
Windows/Linux/macOS 客户端 ─REST + WebSocket→ 控制中心
```

详细的数据流与组件边界见 [架构说明](docs/ARCHITECTURE.md)。

## 三步启动服务端

开始前需要一台具有公网地址的 Linux 服务器，以及指向该服务器的控制台 DNS 记录和通配符 DNS 记录。

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

完整的 DNS、防火墙、Windows 客户端构建和升级说明见 [自托管指南](docs/SELF_HOSTING.md)。不要将示例域名、示例 IP 或任何 `CHANGE_ME` 值用于实际公网部署。

若要从当前源码构建镜像，改用 `docker compose -f compose.yaml -f compose.build.yaml up -d --build`。

## 通用 Windows 客户端

从 [GitHub Releases](https://github.com/ZHanry/home-tunnel/releases) 下载 Windows x64 安装包。首次启动时填写控制中心地址，例如 `https://console.tunnel.example.com`，再输入管理员分配的用户名和密码。客户端通过同源 HTTPS 配置接口获取隧道域名与 FRPS 地址，不需要为每台服务器重新构建；版本检查与安装包下载始终走本项目的 GitHub Releases，不占用自建服务器的下载流量。

如需自行打包，在 Windows 上运行：

```powershell
.\windows-client\packaging\build-exe.ps1 `
  -AppId "{{11111111-2222-3333-4444-555555555555}}"
```

Agent 会核对生成配置中的 FRPS 地址、端口、隧道后缀、自定义域名允许集与 TCP 远程端口允许集是否与客户端从所选控制中心取得的配置一致，同时继续拒绝通用 FRP 命令、UDP 转发、访客配置和任意插件。TCP 默认关闭，只有管理员显式启用并分配端口后才会被 Agent 接受。

## Linux / macOS 无界面客户端

Linux `amd64`/`arm64` 客户端以 systemd 服务运行，macOS `amd64`/`arm64` 客户端以 launchd 服务运行，适合 NAS、家庭服务器和常开设备。两者均通过 WebSocket 接收实时配置通知，并保留三分钟安全轮询；暂不包含 Windows 版的自动更新。构建、安装、首次注册和运维说明见 [`linux-client/README.md`](linux-client/README.md)。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `control-center/` | REST/WebSocket API、管理后台、发布信息展示和 FRPS 授权插件 |
| `traffic-gateway/` | Host 授权、流式反向代理、分层限速和流量采样 |
| `windows-client/` | Windows WPF 客户端和 Inno Setup 打包脚本 |
| `linux-client/` | Linux/macOS 无界面控制进程、systemd/launchd 配置及跨架构打包脚本 |
| `windows-agent/` | 能力受限的 FRP Agent 源码与第三方许可 |
| `deploy/` | Caddy、FRPS、配置生成、生产发布、备份和回滚工具 |
| `tests/` | Compose、安装包和端到端验证脚本 |
| `docs/` | 架构、自托管、安全模型与发布流程 |

## 本地验证

Node.js 22 与 pnpm 11：

```powershell
Set-Location control-center
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm test
pnpm run test:public
pnpm run test:integration

Set-Location ..\traffic-gateway
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm test
```

Windows 与 .NET 8 SDK：

```powershell
dotnet run --project .\windows-client-tests\HomeTunnel.Client.Tests.csproj -c Release
```

Linux 客户端与 Go 1.23.12：

```sh
cd linux-client
go test ./...
go build ./cmd/home-tunnel-client
```

更多开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，发布检查见 [docs/RELEASING.md](docs/RELEASING.md)，本轮跨平台验证结果见 [全功能测试报告](docs/FULL_FUNCTION_TEST_REPORT.md)。

## 安全提示

内网穿透会把原本不可公网访问的服务暴露到 Internet。请确保被发布的应用自身也启用了认证，及时安装服务器与客户端安全更新，并保护好管理员账号、Docker daemon 与代码签名密钥。

不要在公开 Issue 中提交漏洞细节或凭据。请按照 [SECURITY.md](SECURITY.md) 使用 GitHub 私密漏洞报告；部署信任边界见 [安全模型](docs/SECURITY_MODEL.md)。

## 路线图

- 为 Linux/macOS 客户端增加自动更新和签名发布
- 增加自动化数据库备份和恢复演练文档
- 继续降低空闲内存、镜像体积和低配机器启动峰值
- 在真实 macOS 硬件上验证 launchd 安装、注册、崩溃恢复和升级流程

## 许可证

Home Tunnel 使用 [Apache License 2.0](LICENSE)。内置 Agent 基于 FRP，相关 Apache-2.0 许可证与第三方声明保存在 `windows-agent/FRP-LICENSE.txt` 和 `windows-agent/THIRD-PARTY-NOTICES.txt`。
