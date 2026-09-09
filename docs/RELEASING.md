# 发布流程

正式版本使用 `vX.Y.Z` 标签，各组件独立构建。源码版本与标签必须一致，`compatibility.json` 的阶段设为 `public-release`。

1. 提交代码到 `main`，等待 Quality Gate、CodeQL 和 Secret scan 成功。
2. 在已通过检查的提交上创建版本标签。
3. 工作流构建完整安装包，运行组件检查，验证签名与产物身份。
4. 完整构建证明、SBOM 和签名材料保留在 Actions 的 `release-verification-evidence` 附件中；Release 只上传面向用户的交付物。
5. 下载正式发布的安装文件，检查版本、签名与启动情况。

Android 的 Release 附件仅为 `.apk`；桌面端为 `.exe`、`.zip`、Linux / macOS `.tar.gz` 和 `SHA256SUMS.txt`；服务端为部署 `.tar.gz`、`compose.release.yaml` 和 `SHA256SUMS.txt`。APK 的 SHA-256 写入发布说明。项目入口仓库只发布版本说明并链接三个组件。

发布签名由既有 GitHub 环境管理。API 协议夹具继续使用固定版本，跨组件改动必须验证权限、设备隔离及兼容性。工程中的自动化测试保留用于发布验证。
