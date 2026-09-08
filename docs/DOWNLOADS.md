# 获取测试构建

当前以源码构建为主要体验方式，项目暂不提供面向生产使用的稳定版本承诺。

已完成安全修复的客户端测试包：[5.0.1-rc.1](https://github.com/ZHanry/home-tunnel-client/releases/tag/v5.0.1-rc.1)。
包含 Windows x64、Linux amd64 / arm64 和 macOS Intel / ARM 的完整包及校验信息。
测试新客户端前先退出旧版本；历史构建记录不作为当前推荐测试入口。

| 组件 | 构建入口 | 产物与用途 |
| --- | --- | --- |
| 服务端 | [源码启动指南](https://github.com/ZHanry/home-tunnel-server#readme) | 本地构建镜像和 Compose 测试环境 |
| GUI / CLI | [客户端构建指南](https://github.com/ZHanry/home-tunnel-client#readme) | Windows 安装包、Linux / macOS 归档及配套 Agent |
| Android | [调试 APK 构建](https://github.com/ZHanry/home-tunnel-android#readme) | 在测试手机或模拟器上验证管理流程 |

各组件需要分发测试包时，在自己的 Releases 页面以 **Pre-release** 发布，并提供构建来源与校验信息。
仓库中已有的版本编号和发布记录都是开发测试记录，不代表当前存在稳定版支持政策。
首次使用见[开始使用](GETTING_STARTED.md)。
