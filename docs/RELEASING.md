# 测试构建与发布

本仓库负责项目网站和通用文档，不构建、聚合或转发客户端安装包。

每个代码仓库自行维护版本、CI 和测试产物：

- [服务端测试发布](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/RELEASING.md)
- [客户端测试发布](https://github.com/ZHanry/home-tunnel-client/blob/main/docs/RELEASING.md)
- [Android 测试发布](https://github.com/ZHanry/home-tunnel-android/blob/main/docs/RELEASING.md)

当前使用 `internal-testing` 状态和预发布标签。数字版本只识别构建，不等同于成熟度或兼容承诺。
现在无需维护跨仓库的旧更新入口；正式分发前再确定更新和支持策略。
网站由本仓库 Pages 工作流构建并校验。
