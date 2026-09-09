<div align="center">
  <img src="docs/site/assets/HomeTunnel.svg" alt="Home Tunnel" width="72" height="72">
  <h1>Home Tunnel</h1>
  <p><strong>自托管的家庭服务连接平台</strong></p>
  <p><a href="https://github.com/ZHanry/home-tunnel/releases/latest"><img src="https://img.shields.io/badge/release-6.0.0-176653" alt="Release 6.0.0"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0"></a></p>
  <p><a href="README.en.md">English</a> · <a href="https://zhanry.github.io/home-tunnel/">项目网站</a></p>
</div>

Home Tunnel 6.0 正式版通过你自己的公网服务器，让家里的 NAS、相册、Home Assistant 和其他服务随时可达。Web 控制台、桌面端与 Android 端围绕各自的使用场景重新设计。

## 选择你的入口

| 组件 | 用途 | 下载与源码 |
| --- | --- | --- |
| 服务端 | 在公网 Linux 主机上部署控制台与转发服务 | [正式版](https://github.com/ZHanry/home-tunnel-server/releases/latest) · [仓库](https://github.com/ZHanry/home-tunnel-server) |
| 桌面与 CLI | 在 Windows、macOS、Linux 电脑或 NAS 上运行隧道 | [安装包](https://github.com/ZHanry/home-tunnel-client/releases/latest) · [仓库](https://github.com/ZHanry/home-tunnel-client) |
| Android | 从手机管理账号名下的设备与连接 | [APK](https://github.com/ZHanry/home-tunnel-android/releases/latest) · [仓库](https://github.com/ZHanry/home-tunnel-android) |
| 项目入口 | 网站、跨端使用指南与版本说明 | 本仓库 |

## 6.0 带来了什么

- **全新界面结构**：服务端顶部导航、桌面本机服务工作区、手机四个主入口。
- **清晰的设备边界**：已登记的桌面与 CLI 会话只访问本机资源；Web 和 Android 可以管理账号名下的多台设备。
- **完整的账号管理**：每套部署保留一名管理员；删除普通用户时撤销会话和设备凭据、移除连接，保留历史审计。
- **更顺手的操作**：按设备和名称查找连接，明确选择目标设备，保存冲突时保留输入，删除前说明影响。
- **简洁的下载页**：Android 仅提供 APK；桌面端提供各平台安装包；服务端提供部署包。签名与检查记录保存在构建工作流中。

## 开始使用

1. 按[自托管指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md)部署服务端。
2. 在家庭电脑或 NAS 上安装客户端，登录并登记设备。
3. 为这台设备添加连接，填写它可以访问的本地服务地址，再复制公网地址使用。
4. 在 Android 或浏览器中登录同一账号，即可远程管理这些连接。

Android 负责管理，实际隧道持续运行在电脑或 NAS 上。HTTP / HTTPS 连接可自行创建；通用 TCP 和固定端口 UDP 的公网端口由管理员分配，应用负责自身的认证与加密。

## 界面

![6.0 服务端总览](docs/site/assets/admin-dashboard.jpg)

## 文档

[下载说明](docs/DOWNLOADS.md) · [开始使用](docs/GETTING_STARTED.md) · [升级说明](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md) · [架构](docs/ARCHITECTURE.md) · [仓库职责](docs/REPOSITORIES.md) · [贡献指南](CONTRIBUTING.md) · [安全报告](SECURITY.md)
