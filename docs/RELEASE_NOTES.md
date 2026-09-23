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
