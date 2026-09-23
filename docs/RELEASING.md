# Home Tunnel 8.0.0 发布流程

四个仓库保留独立构建与 Release，正式标签使用 `v8.0.0`，源码和产物显示版本使用
`8.0.0`。自有 Agent 同版，FRP 保持独立的 0.70.1。
`compatibility.json` 的阶段为 `public-release`；正式版本号不改变功能限制或验收状态。

## 发布顺序

1. 冻结共享 API。`api-v1.2.0` 是独立的不可改写契约标签，不等于产品 Release；后续服务端发行提交可包含真实客户端下载摘要，不能因此改写契约标签。保留历史契约。
2. 各组件通过 PR、Quality Gate、CodeQL 和 Secret scan 后合并到 `main`，等待最终提交检查成功。开发分支使用 `codex/`，完成后删除，四仓最终仅保留 `main` 分支。
3. 先发布桌面/共享核心。标签 push 仅构建并封存 `candidate-assets`，不会直接公开客户端 Release。保存该次成功构建的 run ID，下载其原始 Windows 安装包及便携包，验证最终分发 worker 的实际字节。
4. 使用这些原始字节完成 Windows 原生视频、键盘、Unicode、鼠标、旧输入代次、心跳失联和 worker 崩溃检查；输入须在 2 秒内释放。报告必须绑定最终 worker 摘要、干净客户端提交和锁定服务端提交。安装/卸载与 Defender 报告须匹配同一批文件，Defender 扫描须在 24 小时有效期内。
5. 对同一个 `v8.0.0` ref 调用客户端 `workflow_dispatch`，提供该构建 run ID 与真实完整验收 JSON。工作流导入报告、重新封存证据、签署清单并发布原始安装包。不得以开发 worker、重新打包文件、`main` ref 或模拟报告替代。
6. 客户端 Release 公开后，Android 核对其标签提交、已验证清单、Sigstore 签名和 SDK 实际摘要，更新同源源码快照及 `native/controller-sdk.lock.json`。通过 Android 检查后发布 `v8.0.0`，保持原 applicationId、签名证书与严格递增的 versionCode。云端和模拟器结果不能写成真机媒体验收通过。
7. 从客户端正式 Release 获取实际 Linux amd64/arm64 包及 SHA-256，更新服务端 `tests/client-baseline.json`。通过两架构发行联调、质量与安全检查后发布服务端 `v8.0.0`。镜像使用固定摘要。
8. 核对三个组件真实 Release 及附件后，再更新入口仓库 `VERSION`、`releases.json`、网站清单副本、下载说明和页面。清单填写实际标签、源提交、附件名、SHA-256 与契约版本，不能预填猜测摘要。入口完成检查后发布自身 `v8.0.0` Release；对外宣布四仓齐备前再次核对四个 Release。7.0 历史版本链接继续有效。

版本标签一旦创建不移动。标签构建失败时保留原始失败记录并排查；源码有变更时
按版本规则发布新的标签，不能把已标记的版本悄悄指向另一个提交。

## 产物与证据

普通用户下载 Android `.apk`、Windows `.exe`/`.zip`、Linux/macOS `.tar.gz`，
服务端下载部署 `.tar.gz` 和 `compose.release.yaml`。Android `.aab`、Windows/Android
共享原生 SDK 以及验证材料保存在各组件 Release 中。

桌面/Android 的 SBOM、扫描/安装报告及签名材料和安装包一起保存；服务端 Release
保存镜像摘要与联调报告，镜像 SBOM/构建证明随 GHCR 的固定摘要保留。
Actions 附件提供额外副本，不能作为唯一的永久交付位置。
保持封存的 `SHA256SUMS.txt` 与 Sigstore bundle 原样；签名后不能重写或删减清单。

发布前下载最终产物核对版本、摘要、签名及启动结果，保留通过、失败和未验证记录。
Windows/macOS 发行签名状态依据实际产物报告；证书未配置就明确披露未签名，半配置
必须失败。Android 沿用已有发行签名。

## 当前范围的披露

每个 Release 都必须链接 [功能与限制](RELEASE_NOTES.md) 和 [验收记录](8.0/ACCEPTANCE.md)。
Windows 直连视频/输入/文件的开发结果与最终包证据分别列出；Linux X11 只开放观看、
键盘和鼠标，隔离 Xvfb 结果不能替代实体桌面。Android 真机解码和输入未验收。
macOS/Wayland 被控、桌面原生观看、系统声音、麦克风回传、虚拟麦克风和 AV1/HEVC
未交付；剪贴板系统互通、多窗口媒体、跨网、完整升级恢复及长期在线仍有待验项目。
不允许因使用正式版本号而把这些能力改成可用或验收通过。
