# 发布流程

正式版本使用 `vX.Y.Z` 标签。7.0.0 将四个仓库与自有 Agent 统一版本，各组件独立构建，FRP 保留其第三方版本。源码版本与标签必须一致，`compatibility.json` 的阶段设为 `public-release`。

1. 三个组件提交到 `main` 后等待 Quality Gate、CodeQL 和 Secret scan 成功；项目入口仓库等待 Pages（包含 Lighthouse 和发布清单检查）与 Secret scan 成功。
2. 在已通过检查的提交上创建版本标签。
3. 工作流构建完整安装包，运行组件检查，验证签名与产物身份。
4. 桌面/Android 的 SBOM、扫描/安装报告及签名材料与安装包一起保存为 Release 附件。服务端 Release 保存镜像摘要与联调报告，镜像 SBOM/构建证明跟随 GHCR 的固定摘要保留。Actions 附件提供额外副本。保持封存的 `SHA256SUMS.txt` 与 Sigstore bundle 原样，不能在签名后重写或删减清单。
5. 下载正式发布的安装文件，检查版本、签名与启动情况。

普通用户下载入口指向 Android `.apk`，桌面 `.exe` / `.zip` 或 Linux / macOS `.tar.gz`，服务端部署 `.tar.gz` 与 `compose.release.yaml`。Android `.aab` 和所有验证证据也在 Release 中持久保留。校验清单覆盖交付物和证据；APK 的 SHA-256 另外写入发布说明。项目入口仓库发布版本说明和发布清单并链接三个组件。

Android 沿用已有发行签名。Windows/macOS 暂无平台证书，7.0.0 明确标注未签名；签名和公证流程已接入，半配置会阻止发布。API 1.1 契约固定于不可改写的 `api-v1.1.0`；保留历史 `api-v1.0.0`。跨组件改动必须验证权限、设备隔离及兼容性。

先发布客户端并取得实际 Linux 7.0.0 包的 SHA-256，再更新服务端 `tests/client-baseline.json`，通过 amd64/arm64 发行联调后发布服务端。最后更新项目入口的 `releases.json`、网站副本和下载说明，使所有链接对应实际正式产物。
