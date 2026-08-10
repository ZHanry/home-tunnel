<div align="center">
  <img src="control-center/public/HomeTunnel.svg" alt="Home Tunnel" width="92" height="92">
  <h1>Home Tunnel</h1>
  <p>面向个人与家庭场景的自托管内网穿透平台</p>
  <p><a href="https://github.com/ZHanry/home-tunnel/actions/workflows/ci.yml"><img src="https://github.com/ZHanry/home-tunnel/actions/workflows/ci.yml/badge.svg" alt="CI"></a></p>
</div>

Home Tunnel 把 FRP、自动 HTTPS、访问策略、管理后台和 Windows 图形客户端组合成一套完整工具。它适合安全发布 NAS、Home Assistant、开发预览等私网 HTTP/HTTPS 服务，同时保留可审计、可限速、可立即停止的集中控制。

> 当前版本为 `2.2.5`。服务端支持从源码构建的 `amd64`/`arm64` 容器；桌面客户端目前仅支持 Windows 10/11 x64。客户端不内置任何运营者域名或 IP，首次登录时由用户填写自己的控制中心 HTTPS 地址。

## 为什么使用 Home Tunnel

- **Windows 友好**：图形化登录、连接管理、系统托盘、自动启动、诊断导出和安全更新。
- **自动 HTTPS**：Caddy 作为唯一公网 Web 入口，按已分配域名签发证书。
- **能力受限的 Agent**：基于固定 FRP 0.62.1 源码构建，只接受与用户所选服务器一致的 Home Tunnel HTTP 隧道配置。
- **集中策略**：用户、设备、连接、带宽和租约状态统一管理。
- **默认隔离**：数据库、控制中心和网关不直接发布主机端口；容器采用只读文件系统和最小能力集。
- **可运维**：健康检查、审计事件、流量聚合、备份与回滚工具，以及版本化发布元数据。

“轻量”主要指个人用户的使用和管理体验，而不是单文件服务端。参考部署包含 Caddy、控制中心、流量网关、PostgreSQL 和 FRPS 五个容器，建议至少准备 2 GiB 内存与 5 GiB 可用磁盘。

## 工作方式

```text
远程浏览器 ─HTTPS→ Caddy ─→ 流量网关 ─→ FRPS ═受管隧道═→ 家中 Windows 主机
管理员     ─HTTPS→ Caddy ─→ 控制中心 ─→ PostgreSQL
Windows 客户端 ─REST/WebSocket→ 控制中心
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
   docker compose up -d --build
   docker compose ps
   ```

3. 读取一次性管理员密码，访问 `https://console.tunnel.example.com/admin` 并立即改密：

   ```sh
   cat deploy/secrets/bootstrap_admin_password
   ```

完整的 DNS、防火墙、Windows 客户端构建和升级说明见 [自托管指南](docs/SELF_HOSTING.md)。不要将示例域名、示例 IP 或任何 `CHANGE_ME` 值用于实际公网部署。

## 通用 Windows 客户端

从 [GitHub Releases](https://github.com/ZHanry/home-tunnel/releases) 下载 Windows x64 安装包。首次启动时填写控制中心地址，例如 `https://console.tunnel.example.com`，再输入管理员分配的用户名和密码。客户端通过同源 HTTPS 配置接口获取隧道域名与 FRPS 地址，不需要为每台服务器重新构建；版本检查与安装包下载始终走本项目的 GitHub Releases，不占用自建服务器的下载流量。

如需自行打包，在 Windows 上运行：

```powershell
.\windows-client\packaging\build-exe.ps1 `
  -AppId "{{11111111-2222-3333-4444-555555555555}}"
```

Agent 会核对生成配置中的 FRPS 地址、端口和隧道后缀是否与客户端从所选控制中心取得的配置一致，同时继续拒绝通用 FRP 命令、TCP/UDP 转发、访客配置和任意插件。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `control-center/` | REST/WebSocket API、管理后台、发布信息展示和 FRPS 授权插件 |
| `traffic-gateway/` | Host 授权、流式反向代理、分层限速和流量采样 |
| `windows-client/` | Windows WPF 客户端和 Inno Setup 打包脚本 |
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

更多开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，发布检查见 [docs/RELEASING.md](docs/RELEASING.md)。

## 安全提示

内网穿透会把原本不可公网访问的服务暴露到 Internet。请确保被发布的应用自身也启用了认证，及时安装服务器与客户端安全更新，并保护好管理员账号、Docker daemon 与代码签名密钥。

不要在公开 Issue 中提交漏洞细节或凭据。请按照 [SECURITY.md](SECURITY.md) 使用 GitHub 私密漏洞报告；部署信任边界见 [安全模型](docs/SECURITY_MODEL.md)。

## 路线图

- 简化跨平台客户端构建与签名流程
- 增加自动化数据库备份和恢复演练文档
- 完善 GitHub Release 多架构镜像发布
- 评估 Linux/macOS 客户端支持

## 许可证

Home Tunnel 使用 [Apache License 2.0](LICENSE)。内置 Agent 基于 FRP，相关 Apache-2.0 许可证与第三方声明保存在 `windows-agent/FRP-LICENSE.txt` 和 `windows-agent/THIRD-PARTY-NOTICES.txt`。
