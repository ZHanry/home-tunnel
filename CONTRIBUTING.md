# 参与开发 / Contributing

本仓库是项目入口、网站和跨组件文档。服务端、桌面和 Android 的实现在各自仓库。

## 提交

1. 从当前开发分支做小改动。发布完成前，远程最终只保留 `main`。
2. 说明问题、改动后的行为和验证结果。
3. 改文档时同步中英文、链接和网站元数据。
4. 不要提交密钥、诊断包、测试机配置或安装包。

稳定通道和候选记录只改 [`distribution.json`](distribution.json)，然后运行：

```bash
python scripts/sync-distribution.py
```

不要手改 `releases.json` 或 `docs/site/releases.json`。候选未晋升时，稳定通道保持上一份已发布快照。10.1.0 的 Server / Client 与保留的 Android 10.0.0 必须分开记录；Android 的原始文件名、标签、版本和摘要不可改写。9.0.0 快照留在 `docs/release/stable-9.0.0.json`，10.0.0 的历史文档继续保留。

## 本地检查

```bash
python scripts/check-release-entry.py
python scripts/check-site-policy.py
python scripts/check-secrets.py
python scripts/check-license.py
python scripts/check-dependencies.py
python scripts/check-v10-evidence.py --status docs/release/acceptance-status.json
python -m unittest discover -s scripts -p "test_*.py"
```

网站在 `docs/site/`。本地预览：

```bash
python -m http.server 8765 --directory docs/site
```

Pages 工作流还会跑 Lighthouse。本仓库没有应用依赖清单，不对空仓库做 npm 或 Go 漏洞扫描。CodeQL 只覆盖这里的 JavaScript 和 Python。密钥扫描在 CI 使用 Gitleaks。

验收记录不能用模拟结果冒充。10.1.0 的 30 次连接和两小时活动证据仅覆盖原始 Windows worker、同机 Chromium 与生产源码 QA host；不扩大为完整 GUI/服务、独立终端、Android、断网恢复或 24 小时验收。10.0.0 历史记录不重写。`docs/release/acceptance-status.json` 记录既有发布的 `accepted_with_waivers`；未运行的虚拟机、网络、迁移和长时间门禁保留原始状态及回执，公开文档标为未验证，不能改写为通过。新的通过声明必须绑定真正的最终产物实测。

推荐的仓库描述、主题和分支保护写在 [docs/governance/recommended-repository-settings.json](docs/governance/recommended-repository-settings.json)。`apply` 为 false，本批不调用 GitHub 去改远程设置。

## English

Edit `distribution.json` for channel changes, then project it. Retain historical 10.0.0 and 9.0.0 downloads after promotion. Keep Android at its actual 10.0.0 artifact identity. Run the Python checks above. Do not claim secure desktop, audio, file acceptance, or final-artifact acceptance beyond the actual evidence scope. Security reports use [SECURITY.md](SECURITY.md). Contributions are under [Apache-2.0](LICENSE).
