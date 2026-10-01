# 测试与验证 / Testing

10.1.0 的原始 Windows worker 字节在同机 Chromium 与生产源码 QA host 的隔离回环环境中通过 30 次连接、7202.463 秒活动和 1391 次采样；显式重启 QA host 后，新配对恢复输入耗时 3507.7 ms。 这些结果不代表完整安装版 GUI、Windows 服务、两台独立 Windows 终端、Android、断网恢复、24 小时在线或 Linux/macOS 运行验收。

本轮没有运行 24 小时测试。完整 GUI/服务、授权界面、音频/剪贴板/文件、Android、网络矩阵、升级恢复、Linux/macOS 等未覆盖项目继续标为未验证。历史 10.0.0 的开发构建结果不能作为新版本最终字节的通过记录。完整范围见 [发布说明](RELEASE_NOTES.md)。下面的表是回归计划，不是已经通过的报告。

每次联调记录服务端、客户端和 Android 的提交 SHA。先验证简单场景，再叠加权限、传输类型和网络故障。

| 场景 | 观察结果 |
| --- | --- |
| 首次部署与登录 | 配置生成、HTTPS、初始改密、普通账号登录是否正常 |
| 设备注册 | 正确账号能看到设备，其他账号看不到或无法操作它 |
| HTTP 连接 | 本地服务可达，公网地址可访问，暂停后访问终止 |
| 配置修改 | 修改目标或连接状态后，客户端与服务端显示一致 |
| GUI 与 CLI | 各自独立完成注册、状态查看和连接操作 |
| 断线与重启 | 能显示错误、恢复连接，不出现重复进程或过期状态 |
| TCP / UDP | 只使用分配端口，未授权配置被拒绝，撤销后流量终止 |
| Android | 登录、设备列表、编辑、断网、会话过期、屏幕旋转与后台恢复 |
| 数据与备份 | 测试数据可持久化，备份可在隔离环境验证恢复 |

CI 覆盖源码检查、单元测试、部分浏览器与集成场景；实际设备、网络和长期运行仍需记录测试结果。

## 有用的反馈

- 仓库、提交 SHA、操作系统、CPU 架构；Android 附系统版本与设备型号。
- 构建与启动方式、复现步骤、预期和实际结果。
- 脱敏后的错误信息、相关时间点，以及问题是否可重复。

不要提交密码、令牌、私钥、完整设备状态文件或真实家庭网络拓扑。疑似漏洞使用各仓库的私密安全报告入口。

## English

The original 10.1.0 Windows worker bytes passed 30 connections and 7202.463 seconds of activity with 1391 samples, using same-machine Chromium and a production-source QA host in an isolated loopback environment. After an explicit QA host restart, a new pairing restored input in 3507.7 ms. This does not establish full installed-GUI, Windows service, independent Windows-endpoint, Android, network-outage recovery, 24-hour online, or Linux/macOS runtime acceptance. The table above is a regression checklist, not a pass record. Historical development-build evidence is not acceptance of new final bytes. The 24-hour test was not run.
