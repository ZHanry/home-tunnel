# 仓库职责与兼容性

从原项目提交 `cdf6136593d3dd7863f704724746a92a30240123` 拆出三个代码仓库，保留各组件相关的提交历史和作者信息。
过滤后的提交 ID 会发生变化；原仓库的完整历史和历史标签保留。

| 原目录 | 新归属 |
| --- | --- |
| `control-center/`、`traffic-gateway/`、`deploy/`、服务端测试 | `home-tunnel-server` |
| `linux-client/` | `home-tunnel-client` 根目录：`cmd/`、`internal/`、`packaging/` |
| `windows-agent/` | `home-tunnel-client/agent/`，跨平台共用 |
| 桌面页面测试 | `home-tunnel-client/tests/browser/` |
| `android-client/` | `home-tunnel-android` 根目录 |
| 项目网站与通用文档 | 本仓库 |

各代码仓库都有自己的 CI、贡献指南、兼容记录和发布流程。服务端构建不依赖客户端源码；
GUI 和 CLI 共用客户端核心；Android 只通过服务端 API 管理账号资源。

## 版本与协议

拆分基线是已发布的服务端 / 客户端 / Android 5.0.0 与 API v1。
之后各组件独立使用语义化版本号，不能仅凭组件版本号相同推断兼容。
协议夹具由服务端维护，以 `api-v1.0.0` 等不可移动标签发布。
客户端与 Android 保存固定版本的协议快照及 SHA-256，正常构建无需访问另一份源码。
版本组合需要通过契约与集成验证后记录在对应仓库的 `compatibility.json`。

## 升级和发布衔接

- 原 5.0.0 Release 和服务端镜像地址保留，现有部署与下载链接继续可用。
- 新客户端源码使用客户端仓库的更新入口。新稳定客户端发布后，运行本仓库
  `Mirror stable client release` 工作流，将同一套经过验证的产物提供给旧客户端更新入口。
  镜像发布保留旧版固定文件名的下载，避免已有服务端页面链接失效。
- Android 保留 `io.github.zhanry.hometunnel`、固定发布证书和递增版本代码。
- 各仓库继续先构建和验证 RC，再将同一提交、同一批产物提升为 Stable。

## 后续工作位置

服务端问题进入 `home-tunnel-server`；电脑、NAS、GUI、CLI 和 Agent 问题进入
`home-tunnel-client`；手机 App 问题进入 `home-tunnel-android`。网站和跨组件规划留在本仓库。
