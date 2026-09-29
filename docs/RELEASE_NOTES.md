# Home Tunnel 10.0.0

2026-09-29 发布。服务端/Web、桌面/CLI、Android 与自有 Agent 统一为 10.0.0，FRP 独立保持 0.70.1。REST 路径仍是 `/api/v1`，冻结契约为 `api-v1.4.0`（服务端提交 `74e140da43c88043d0db2aad7505ba75fd3a9a49`）；`api-v1.3.0` 及更早的契约标签不变。

本版经负责人批准，带**负责人豁免**发布：下方列出的项目没有运行，豁免不等于通过，也不能写成已验收。

## 新内容

- 远控载荷（画面、声音、输入、剪贴板、文件）走经过认证、端到端 DTLS 加密的 UDP，优先 P2P 直连。
- 服务端可选部署 UDP TURN 中继（coturn，`deploy/compose.turn.yaml`）。直连失败时，浏览器控制端可经中继连接 10.0.0 被控端；载荷仍端到端加密，中继读不到内容。没有 TCP 回退。Android 控制端和 9.x 被控端只走直连。
- 登录即开启被控。陌生连接在右下角弹出置顶、不抢焦点的审批框；连接期间显示"正在被远程控制 · 断开"条。设备 ID 显示为分组的 9 位数字。
- 一次性临时密码使用固定设备 ID，生成新密码会撤销旧密码。固定密码跳过审批。
- 接受请求或临时密码后，本次连接放行画面、键鼠、剪贴板、文件和系统声音。麦克风从不自动放行。9.x 被控端仍只有画面/键鼠/剪贴板。
- 授权后的系统声音（普通桌面上的 WASAPI 回环），不采集麦克风。
- 重做的浏览器控制端：浮动工具栏、单一开始/停止按钮、后台剪贴板同步、快捷键与"更多"菜单、延迟标记。
- 引导式服务发布（本机目标检查、设备上报验证），以及本地化、主题、移动端导航和无障碍修复。
- Android：arm64-v8a 与 x86_64 使用同源生产远控 SDK；新增系统声音播放、授权文件传输、显示器选择、有界重连和视口手势；软键盘弹出时登录、MFA、改密和隧道编辑保持可见。沿用原 applicationId 与发行证书，versionCode `10000000`。
- 服务端迁移 020、021 为增量迁移，9.0 数据仍可读取。稳定发布晋升已验收、已封存的候选字节与镜像摘要，不重新构建。

## 验证范围

在从 9.0.0 升级的生产服务器上，Web 控制端经 10.0.0 服务端控制 Windows 10.0.0 被控端，直连 UDP 和 TURN 中继两种路径都实测可用：

- 画面、键盘、鼠标和中文输入
- 双向剪贴板
- 控制端到被控端的文件传输，SHA-256 校验一致
- 系统声音
- 审批弹窗与临时密码模式

这些结果来自同一功能代码的开发构建，没有在最终发布字节上重跑。Android 的 Gemini 界面审查针对模拟器上的开发构建截图。

## 负责人豁免（未验证）

以下项目没有运行，在各组件附带的验收记录中标为 `waived`，不计为通过：

- 被控端到控制端的文件传输
- 最终构建上的固定密码模式
- Android 控制 Windows 被控端
- Windows 控制 Windows
- arm64 实体手机
- 最终 APK 的 API 26/35 模拟器运行
- 多显示器与 DPI
- 9→10 安装器升级与备份恢复
- 30 次连续连接、2 小时活动和 24 小时在线
- NAT、IPv6、UDP 被封与网络恢复矩阵
- 性能对比
- 隧道运行矩阵
- Linux 与 macOS 运行
- 最终界面的完整 Gemini 审查

## 限制

- 不支持锁屏、登录前和 UAC 安全桌面控制；无人值守就是已登录桌面上的固定密码。
- 没有麦克风回传。
- Windows/macOS 可执行文件没有发行商签名（Authenticode / Developer ID）；SHA-256、Sigstore 和恶意软件扫描不是系统签名。Android 保持原发行证书。
- 远控默认关闭。部署前确认加密备份能恢复，并用 Release 的 `compose.release.yaml` 固定镜像摘要。见 [升级](UPGRADING.md)。

文件与校验值见 [下载](DOWNLOADS.md)。组件说明：[Server](https://github.com/ZHanry/home-tunnel-server/releases/tag/v10.0.0) · [Client](https://github.com/ZHanry/home-tunnel-client/releases/tag/v10.0.0) · [Android](https://github.com/ZHanry/home-tunnel-android/releases/tag/v10.0.0)。

## English summary

Home Tunnel 10.0.0 is published for all four repositories with owner waivers. FRP stays at 0.70.1; the API stays `/api/v1` with frozen contract `api-v1.4.0`. Remote payloads use end-to-end DTLS-encrypted UDP, direct P2P first; an optional UDP TURN relay lets browser viewers reach 10.0.0 hosts when direct fails, the relay cannot read payloads, and there is no TCP fallback. Android controllers and 9.x hosts are direct-only. A Web viewer controlled a Windows 10.0.0 host through the production server over direct UDP and the relay (development builds of the same code, not re-run on the final bytes). The items listed under 负责人豁免 were not verified; a waiver is not a pass. Lock screen, pre-login, UAC secure desktop and microphone return are not available, and desktop packages carry no publisher signature.

## Previous release: 9.0.0

# Home Tunnel 9.0.0

四个仓库与自有 Agent 统一为 9.0.0，FRP 独立保持 0.70.1。网站、Windows 和 Android 更新了视觉与导航；远程桌面和内网穿透分区，远控使用独立窗口。登录仅在服务端要求 MFA 后显示动态码输入。更新检查只认正式 GitHub Release。

跨账号远控支持被控端批准临时请求、被控端预设固定密码，以及一次性临时密码。双方须登录同一服务器；访问仍受签名票据、租约、端点身份和即时撤销约束。服务端 API 契约为 `api-v1.3.0`，不扩大原有同账号查询权限。远控载荷只走 UDP P2P，不提供媒体中继。

**验证限制：** Windows 锁屏、登录前和 UAC 安全桌面控制及高权限代理尚未完成；音频不可用。Android API 35 x86_64 模拟器测试不能证明发行 arm64 APK 或真机运行；剪贴板实际互通也未验收。跨网、长期在线及完整升级恢复不因正式版本号而视为通过。Windows/macOS 没有发行商签名证书；Android 保持原应用 ID 与发行证书。以各组件 9.0.0 Release 的实际构建和验收报告为准。

桌面端首次未发布的 9.0.0 标签构建因遗留 Linux 版本守卫失败（[构建记录](https://github.com/ZHanry/home-tunnel-client/actions/runs/35984898445)）；随后一次发行验证因旧验收字段名被拒绝（[验证记录](https://github.com/ZHanry/home-tunnel-client/actions/runs/35996490571)）。两次均未发布附件，修复后在公开发行前重建标签；原失败记录保留。上一候选包的同机跨账号测试中，固定密码和临时密码各有一次短暂的媒体/会话失败，重复两次通过，不据此承诺长期稳定或跨网可靠。

## Previous release: 8.0.0

# Home Tunnel 8.0.0

8.0.0 保留原有隧道、账号、设备管理与部署运维流程，增加独立授权的远程桌面基础和
Windows/浏览器直连路径。四个仓库与自有 Agent 使用 8.0.0，FRP 保持 0.70.1。
REST 路径保持 `/api/v1`，API 契约固定于 `api-v1.2.0`。

**本版的平台覆盖和完整验收仍有缺口。版本号不代表原方案全部完成。**
以下区分实现范围与验证范围；实际发行文件、签名、源提交和最终安装包测试结果请
查阅各组件 Release 证据。

## 功能范围与限制

| 平台或能力 | 8.0.0 范围 | 验证边界 |
| --- | --- | --- |
| Windows x64 被控 + 浏览器 | H.264/VP8 视频、键鼠、Unicode 文本、双向多文件；端点身份、配对、本机批准、租约与撤销 | 最终 Windows 包的同机验证通过真实视频、输入和空/多分块文件。完整用户文件选择、高 DPI、多屏、锁屏、跨网仍待验收；最终包结果单独记录 |
| Linux x64 X11 被控 | 观看、键盘、鼠标；活动/未锁屏会话检查与输入释放守护 | 隔离 Xvfb 环境通过媒体和输入检查；实体桌面与锁屏恢复未验收。文本、剪贴板、文件不可用 |
| Android 控制端 | 同源核心、JNI、Surface、身份配对与生命周期处理；原有多服务器管理 | 真机解码与输入尚未验收；音频、麦克风、剪贴板/文件、多会话界面和增强编码不可用 |
| macOS、Linux arm64、NAS/CLI | 原有客户端与隧道管理 | macOS/Wayland 被控及桌面原生观看窗口未交付；无图形能力的 CLI/NAS 不报告可被控 |
| 文本剪贴板 | Windows 已实现显式授权、去重和回环抑制 | 协议检查已通过，实际系统剪贴板互通尚未验证 |
| 编码 | Windows H.264/VP8 软件编码已有真实互通证据 | 不代表硬件加速已验收；AV1/HEVC 未交付 |
| 音频 | 系统声音、麦克风回传及各平台虚拟麦克风未交付 | 不提供可用性承诺，相关能力保持不可用 |
| 多窗口、跨网与长期使用 | 会话配额与窗口隔离已实现部分检查 | 多路媒体、8×5 实际平台组合、2 小时活动/24 小时在线、完整升级恢复均未完成 |

远控画面、输入、剪贴板和文件按协议只允许 UDP P2P。服务器处理身份、授权、
信令与 STUN；无法直连时明确失败，不以 TURN、ICE-TCP、FRP、HTTP 或 WSS
作为载荷回退。隧道业务仍采用原有服务端转发路径，两者用途不同。

Windows 文件传输使用独立可靠 DataChannel、显式文件权限、流式读写和 SHA-256
校验，支持进度、取消及异常清理。最终 Windows 包证据包括双向空文件、多分块文件、取消、
授权撤销和 worker 终止时的临时文件清理；这些测试不能代替每个平台的完整交互验收。

默认不包含 Android 被控、登录前/UAC 安全桌面、跨账号共享、图片剪贴板和目录递归传输。

## 最终包实测

[H.264 / 输入 / 文件报告](8.0/evidence/windows-final-package-h264.json) 与
[VP8 视频报告](8.0/evidence/windows-final-package-vp8.json) 使用正式标签最终分发的 Windows worker。
心跳失联后按键释放为 1688.3 ms；worker 崩溃后按键/鼠标释放为 28.4/29.6 ms。
H.264 轮次验证真实键鼠、中文及双向文件字节；VP8 轮次验证实际持续视频。
两次均使用同机 Chromium 和隔离测试环境，不代表跨网、完整文件选择器或其余平台验收。

## 升级、签名与证据

升级前备份并结束远控会话。保留 7.0 隧道兼容路径；8.0 客户端连接旧服务端时，
通过能力发现显示远控不可用。完整升级与恢复演练尚未覆盖全部平台。
最终 Windows/macOS 包均记录为未配置发行证书，未作 Authenticode / Developer ID 签名；SHA-256 与 Sigstore 构建身份不等于平台发行证书。
Android 保持原 applicationId 与发行证书，并使用递增的 versionCode。

桌面/Android 的 SBOM、源码及库摘要和构建证明随对应 Release 保存。
服务端 Release 提供固定镜像摘要与部署材料，镜像 SBOM/证明保存在对应 GHCR 摘要上。
开发证据、隔离容器、模拟器与云端构建结果不会替代最终包或实机验收。

[下载与兼容性](DOWNLOADS.md) · [完整范围](8.0/SCOPE.md) · [逐项验收](8.0/ACCEPTANCE.md) · [升级指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md)

7.0.0 历史下载继续保留：[Server](https://github.com/ZHanry/home-tunnel-server/releases/tag/v7.0.0) · [Client](https://github.com/ZHanry/home-tunnel-client/releases/tag/v7.0.0) · [Android](https://github.com/ZHanry/home-tunnel-android/releases/tag/v7.0.0)。网站原有控制台截图仍为 7.0.0 示例。

## English release scope

Home Tunnel 8.0.0 retains tunnel management and adds separately authorized remote
desktop sessions. Windows-to-browser H.264/VP8 video, keyboard/pointer, Unicode
text and bidirectional files have passed same-machine checks of the final Windows package. Linux
x64 X11 exposes view, keyboard and pointer only, with isolated Xvfb evidence.
Android integrates the same-source controller through JNI and Surface, but actual
device decoding and input remain unverified.

macOS/Wayland hosting, native desktop viewers, system audio, microphone return,
virtual microphones and AV1/HEVC are not delivered. Windows system clipboard
interoperability, physical Linux desktops, concurrent media windows, cross-network
traversal, complete upgrade/restore and long-running acceptance remain incomplete.
The version number does not imply completion of the full plan.

Remote-desktop payloads require direct UDP P2P and fail explicitly when no direct
path is available. Consult each component Release for actual artifact identities,
signing status and final-package evidence. The Windows/macOS packages have no Authenticode / Developer ID release signature. Android retains its existing app ID and
release certificate. Historical 7.0.0 downloads and the labeled 7.0 console
screenshot remain available.
