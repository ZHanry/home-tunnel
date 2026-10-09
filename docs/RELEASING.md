# 发布 nestlink 13.0.0

四仓 main 正常快进推送，保留历史标签。用户可见版本为 `13.0.0`，Git 标签为 `v13.0.0`，GitHub Release 为正式版。精确 main 提交的 Quality Gate、CodeQL 和 Secret scan 全部通过后才创建标签，已创建的标签与封存附件不覆盖。

发布复用完成实际联调的成功 CI 构建字节。验收记录绑定运行源码、构建 run 和交付文件 SHA-256；最终标签相对该源码只允许增加 `docs/release/acceptance-13.0.0.json`、`docs/HOMEDESK_RELEASE.md` 和 `docs/RELEASE_NOTES.md`。运行代码改变时必须重新构建和验收。Android 固定通过验收的 Client 运行源码，不跟随仅增加发行文档的提交。

附件数量：Server 3、Client 5、Android 3、总仓 2。Client 包含 Windows x64 安装器、Linux x64/ARM64 DEB、材料 ZIP 和 SHA256SUMS。Android 保留 applicationId、原证书和升级身份，提供两架构通用 APK。Server 发布部署包及通过验证的镜像摘要；材料包含对应源码、许可证、精确子模块、构建与安装/模拟器证据。Sigstore 绑定发布工作流身份与 BUILD.json，不能替代 Windows Authenticode 签名。

组件发布完成后运行 `verify-nestlink-components.yml`，实际下载所有附件，核对不可变标签、数量、字节/摘要、对应源码、Sigstore 和可复现验收。独立结果保存在 `docs/release/components-13.0.0.json`，以此晋升 `distribution.json` 的稳定通道。运行 `python scripts/sync-distribution.py` 和 `python scripts/homedesk_downloads.py` 投影站点清单，再检查网站、提交 main 并封存总仓验收。总仓发布流程重新下载核验组件，生成材料 ZIP 与 SHA256SUMS。

自动化及可复现联调通过是本次发行门槛。真机、运营商网络和长期媒体等未执行范围在发行说明中明确保留，不引用历史长测作为新版本验收。生产部署升级另行执行。
