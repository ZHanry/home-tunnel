# 发布 HomeDesk 候选

四仓 main 使用正常快进推送，保持源分支历史与旧标签。产品 tag 只在精确 main 提交的 Quality Gate、CodeQL、Secret scan 全部成功后创建。Client/Android 发布复用同一提交成功 CI 的原始产物；Server 构建带摘要、SBOM 与签名的多架构镜像，并运行真实穿透 smoke 和 hbbs 身份/运行检查。

固定候选附件上限：Server 3、Client 4、Android 3、总仓 2。源码、精确子模块、第三方源码/许可证、构建与安装/模拟器证据收进材料 ZIP。SHA256SUMS 覆盖公开附件，BUILD.json 绑定源码与交付文件，Sigstore 证明 GitHub 工作流身份。附件不能通过 clobber 覆盖；失败修复采用新提交，已创建的 RC tag 不移动。

总仓先运行 `python scripts/verify-homedesk-components.py --record`，下载三仓真实 Release，核对不可变 tag、附件数量、实际 bytes/SHA256SUMS、材料 manifest 与对应源码。运行 `python scripts/sync-distribution.py` 生成网站清单，再检查、提交 main。总仓 tag 的发布流程还会验证三个材料签名，生成一个分发 ZIP 与一个校验文件。

候选只发布 prerelease，latest=false；稳定通道保持 10.1.0。跨网 NAT、长期媒体、真机与完整安装后端到端远控尚未完成，不使用旧 10.x 验收或历史豁免晋升新的稳定版。
