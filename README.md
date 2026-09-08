<div align="center">
  <img src="docs/site/assets/HomeTunnel.svg" alt="Home Tunnel" width="92" height="92">
  <h1>Home Tunnel</h1>
  <p>面向个人与家庭服务的自托管内网穿透平台</p>
  <p><a href="https://zhanry.github.io/home-tunnel/">项目网站</a> · <a href="README.en.md">English</a></p>
</div>

Home Tunnel 用集中管理、可撤销的设备授权和受管隧道，发布家中的 Web、TCP 和固定端口 UDP 服务。

## 代码仓库

本仓库现在是项目主页、通用文档和下载入口。各组件的源码、测试和发布流程分别维护：

| 仓库 | 职责 |
| --- | --- |
| [home-tunnel-server](https://github.com/ZHanry/home-tunnel-server) | 服务端 API、Web 管理后台、流量网关和 Caddy / FRPS 部署 |
| [home-tunnel-client](https://github.com/ZHanry/home-tunnel-client) | Windows / macOS / Linux 共用的 GUI、CLI、后台运行逻辑和隧道 Agent |
| [home-tunnel-android](https://github.com/ZHanry/home-tunnel-android) | Android 远程管理 App，管理家中设备和连接 |

GUI 和 CLI 共用客户端核心。Android 用于远程管理，手机本身不运行隧道。
架构、兼容性与迁移说明见 [仓库拆分说明](docs/REPOSITORIES.md)。

## 快速开始

在公网 Linux 服务器上：

```sh
git clone https://github.com/ZHanry/home-tunnel-server.git
cd home-tunnel-server
sh deploy/scripts/new-selfhost-config.sh tunnel.example.com 203.0.113.10 console.tunnel.example.com admin@example.com
docker compose config --quiet
docker compose pull
docker compose up -d
```

完整配置见[服务端自托管指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md)。
在家中的电脑或 NAS 安装[统一客户端](https://github.com/ZHanry/home-tunnel-client)，注册设备并创建连接。

## 下载与已有用户

[下载导航](docs/DOWNLOADS.md)提供各端稳定版与后续独立发布入口。
已经发布的 [5.0.0 安装包和发布记录](https://github.com/ZHanry/home-tunnel/releases/tag/v5.0.0)继续保留。
此次源码迁移无需用户重装服务器、重新注册设备或更换 Android 应用。

## 反馈与贡献

组件问题请优先提交到对应代码仓库；跨组件问题和项目建议可以继续在本仓库讨论。
通用参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。旧 Issue、提交历史、Release 和网站地址继续保留。

Apache-2.0，见 [LICENSE](LICENSE)。
