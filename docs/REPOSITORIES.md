# 仓库职责与协作

## 代码归属

| 仓库 | 维护内容 | 主要交付物 |
| --- | --- | --- |
| [home-tunnel-server](https://github.com/ZHanry/home-tunnel-server) | 控制中心、Web 管理后台、HTTP 网关、Caddy / FRPS 配置 | 服务镜像与部署配置 |
| [home-tunnel-client](https://github.com/ZHanry/home-tunnel-client) | 桌面窗口、CLI、同步核心、Agent、系统服务与安装器 | 各平台客户端安装包 |
| [home-tunnel-android](https://github.com/ZHanry/home-tunnel-android) | 手机界面、账号会话、设备与连接管理 | 调试 APK 与签名安装包 |
| [home-tunnel](https://github.com/ZHanry/home-tunnel) | 网站、通用文档、测试入口与路线规划 | 项目网站与文档 |

GUI 和 CLI 共用核心，避免在两个产品里重复实现登录、配置同步和进程管理。
服务端各进程在一个仓库协作，可以使用不同容器运行。
Android 是 API 管理端，转发引擎由电脑或 NAS 客户端提供。

## 协议协作

服务端的 `contracts/` 保存协议测试夹具，初始协议标识为 API v1。
客户端和 Android 保存明确来源和 SHA-256 的快照，普通构建不需要另一个仓库的检出目录。
夹具目前描述部分字段、事件和约束，不是完整 OpenAPI 文档。

正式发布期间可以调整协议，但一次接口改动应明确列出受影响组件，并完成相应联调。
更新夹具时先在服务端验证，再发布新的协议标签，最后更新消费者的快照和锁文件。
不要移动已使用的协议标签，以免相同标识对应不同内容。

## 版本和状态

各组件自行维护构建版本。当前状态在代码仓库的 `compatibility.json` 中记录为 `public-release`。
数字版本号用于识别构建，不代表产品稳定性。现在不承担历史构建的长期兼容或升级桥接义务。
正式版本使用 vX.Y.Z 标签，并通过组件质量与安全检查后发布。

## 修改放哪里

组件内的问题在对应仓库提交 Issue 和 PR；跨组件修改在描述中列出相关仓库与提交。
Web 控制台的 UI 属于服务端，客户端窗口的 UI 属于客户端，产品介绍网站属于本仓库。
共享协议改动、公共概念和测试方案应同步更新通用文档。
