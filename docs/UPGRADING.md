# 升级 / Upgrade

当前稳定组合为 **Server / Client（含 Agent）10.1.0 + Android 10.0.0**；FRP 独立保持 **0.70.1**。Android 10.0.0 是保留的兼容版本，不需要把 APK 改名或重新安装一个不存在的 10.1.0 版本。

## 从 10.0.0 升到 10.1.0

1. 做异机备份，并确认能在隔离环境恢复。见[服务端恢复文档](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md)。
2. 结束正在进行的远控会话。
3. 按[服务端升级说明](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md)升级 Server 10.1.0，使用对应 Release 的 `compose.release.yaml` 固定镜像摘要。
4. 升级 Client / CLI / Agent 到 10.1.0。原生登录交接和当前设备改名需要 Server 10.1.0；Android 保留原 10.0.0。
5. 登录原账号，检查设备与已有 FRP 连接，再在自己的环境验证一个已知服务和授权远控流程。

## 验证到哪里

10.1.0 的原始 Windows worker 字节在同机 Chromium 与生产源码 QA host 的隔离回环环境中通过 30 次连接、7202.463 秒活动和 1391 次采样；显式重启 QA host 后，新配对恢复输入耗时 3507.7 ms。 这些结果不代表完整安装版 GUI、Windows 服务、两台独立 Windows 终端、Android、断网恢复、24 小时在线或 Linux/macOS 运行验收。完整安装器升级与备份恢复尚未验证，不能由两小时 worker 测试替代。24 小时测试未运行。Windows/macOS 仍未签名。详见 [发布说明](RELEASE_NOTES.md)。

## 历史路径：9.0.0 到 10.0.0

10.0.0 的服务端迁移 020、021 为增量迁移。历史实测是在从 9.0.0 升级的生产服务器上完成，但未覆盖完整 9→10 安装器升级或备份恢复。需要浏览器中继时才配置 `deploy/compose.turn.yaml`。9.x 被控端仍只有画面、键鼠、剪贴板，也不走中继。

## 回滚

出问题时停止继续升级，并按备份文档恢复。不要让旧服务端直接运行已迁移的新数据库。10.0.0 和 9.0.0 的发布页继续保留；回滚使用与备份匹配的组件及数据。

## English

Upgrade Server / Client, CLI and Agent to 10.1.0; keep the compatible Android 10.0.0 files unchanged. FRP remains 0.70.1. Back up and prove a restore first, end remote sessions, then use the matching server release Compose file with pinned image digests. Native sign-in handoff and current-device rename require Server 10.1.0.

The original 10.1.0 Windows worker bytes passed 30 connections and 7202.463 seconds of activity with 1391 samples, using same-machine Chromium and a production-source QA host in an isolated loopback environment. After an explicit QA host restart, a new pairing restored input in 3507.7 ms. This does not establish full installed-GUI, Windows service, independent Windows-endpoint, Android, network-outage recovery, 24-hour online, or Linux/macOS runtime acceptance. Full installer upgrade and restore remain unverified. The 24-hour test was not run. Restore a matching backup when rolling back; do not run an older server directly against a migrated database.
