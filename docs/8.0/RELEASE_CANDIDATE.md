# 8.0 候选版发布要求

当前没有可下载的 8.0 候选版。稳定下载入口仍是 7.0.0；源码中的 `8.0.0` 和 `internal-testing` 仅标记开发目标。

在真实 Windows/浏览器 UDP 视频和输入闭环、自动化安全检查与发行包验证通过后，才创建 `v8.0.0-rc.N`。未验证的系统/GPU/网络/驱动必须逐项列为限制，安装包与界面禁止显示为可用。正式 8.0.0 还要求完整实机、跨网、升级恢复、签名和长期验收。

候选清单单独写入 `candidate-releases.json` 与网站副本，不覆盖 `releases.json`、`VERSION` 或稳定下载。尚未生成真实产物时不创建带虚构摘要的清单。清单由四个仓库的实际 Release 标签、提交、附件 URL、字节数、SHA256 和已封存测试报告组成。

```powershell
python scripts/check-candidate-release.py candidate-releases.json
python scripts/check-candidate-release.py candidate-releases.json --verify-remote
```

第一条只校验清单结构和门禁声明；第二条验证 GitHub 标签提交、预发布属性，下载所有附件重新计算摘要，并验证独立 API 契约标签。发布入口前必须执行第二条，不能用第一条替代真实下载验收。契约提交与服务端发行提交可以不同，二者均须明确绑定。

交付顺序：冻结候选契约 → 桌面核心/客户端 → Android 同源核心及原发行证书 → 服务端真实客户端基线/镜像 → 入口清单。每次重新构建都重新验证，Android versionCode 从 8000001 起严格递增。失败的检查不能通过将结果改写为“未验证”绕过。
