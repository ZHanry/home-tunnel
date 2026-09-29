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

不要手改 `releases.json` 或 `docs/site/releases.json`。候选未晋升时，稳定通道保持上一份已发布快照；10.0.0 晋升后，9.0.0 快照留在 `docs/release/stable-9.0.0.json`。

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

10.0.0 验收记录不能用夹具冒充。`docs/release/acceptance-status.json` 在真正的虚拟机、网络、迁移和长时间门禁完成前保持 `not_submitted`。

推荐的仓库描述、主题和分支保护写在 [docs/governance/recommended-repository-settings.json](docs/governance/recommended-repository-settings.json)。`apply` 为 false，本批不调用 GitHub 去改远程设置。

## English

Edit `distribution.json` for channel changes, then project it. Keep 9.0.0 downloads working until promotion. Run the Python checks above. Do not claim secure desktop, audio, file acceptance, or 10.0.0 stable downloads without a real evidence record. Security reports use [SECURITY.md](SECURITY.md). Contributions are under [Apache-2.0](LICENSE).
