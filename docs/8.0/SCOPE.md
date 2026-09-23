# 8.0 已确认范围与开发工作表

本文件将项目方案 2.0 与此次确认的扩展合并为 8.0 开发范围。维护者最新要求直接发布 `8.0.0` 正式版、完成后四仓只保留 `main`，并实际发布 GitHub Release。构建与发布完成前稳定入口仍为 7.0.0；未完成的能力继续如实列出，不因正式版命名而标为通过。方案中将多窗口列为 8.1、音频/剪贴板/文件/增强编码列为 8.2 的安排已被本次范围覆盖，不再作为延期依据。

| 能力 | 8.0 交付要求 | 当前状态 |
| --- | --- | --- |
| 控制面 | 独立身份、双端配对、本机授权、DPoP、ES256、持久租约、撤销、四出站/单入站配额 | 已实现，自动化验证中 |
| 共享协议 | API 1.2、独立 RD/ABI 版本、四语言常量与真实签名向量 | API 候选契约已冻结为 `api-v1.2.0-rc.1`，客户端快照绑定实际提交和摘要 |
| 原生媒体 | 同源 C++20/libwebrtc；实际 UDP 对确认后才开放数据 | Windows 原生捕获→真实控制面→Chromium 视频直连已在同机开发环境通过；跨机/跨网待验收 |
| Windows | 捕获、编码、解码、输入、隔离 worker、权限与单包升级 | 原生被控 worker、私有管道和 GUI 能力检查已集成；Windows 开发安装包已构建；输入与最终包验收进行中，桌面观看端未完成 |
| macOS | ScreenCaptureKit、VideoToolbox、TCC、原生窗口 | 尚未完成与实机验收 |
| Linux | X11；GNOME/KDE Wayland Portal、PipeWire、libei | Xorg/logind 权限门、输入守护和 GUI 候选包已构建；隔离环境实际 H.264/VP8/UDP、XTest 与包摘要验证通过；实体桌面与 Wayland 待验收 |
| 网页 | 身份与配对、观看、显示器切换、焦点输入、诊断、最多四窗口 | 与 Windows 真实视频、中文/键鼠和双向文件同机互通通过；切屏、多路和最终包实机验收进行中 |
| Android | 相同源 JNI、Surface、触控、IME、前后台与切网 | APK/JNI 构建、110 次 JVM 执行及 API 26/35 仪器测试通过；真机/实际解码待验证 |
| 多窗口 | 每控制端/账号默认四会话，每被控端一会话；单窗关闭互不影响 | 会话模型及窗口隔离测试；媒体并发待验证 |
| 系统声音 | 独立 Opus 轨，默认关闭、显式授权与关闭 | 权限与控制协议已纳入；平台捕获待完成 |
| 麦克风 | 仅一个指定会话；停止清缓冲并静音；目标应用选虚拟输入 | 控制协议已纳入；三个虚拟音频后端和签名待完成 |
| 文本剪贴板 | 独立授权，指定一个会话，64 KiB、去重、回环抑制 | Windows 原生文本读写和独立通道已实现并编译，授权/撤销/超时/哈希/回环自动化通过；系统剪贴板实测待验证 |
| 多文件 | 显式选择文件/目的地、逐块流式读写、背压、取消、SHA256、空间不足 | Windows 原生与浏览器真实双向临时文件、空文件、多分块及哈希已通过；Win32 选择框取消实测通过，完整用户选择与跨网待验收 |
| 编码协商 | H.264/VP8；真实支持时启用 AV1/HEVC，失败回退与诊断 | Windows→Chromium 同机 1920×1080 H.264 与 VP8 各自通过真实 UDP/身份/编解码验证；均为软件编码，硬件与跨网待验证 |
| 运维 | STUN-only、限流、迁移校验、密钥轮换、备份恢复与 epoch | 真实 coturn 容器/防火墙隔离测试通过；迁移/密钥/恢复自动化通过；公网待验证 |
| 发布 | 四独立仓库、质量检查、8.0.0 正式 Release/产物/报告/摘要，完成后只保留 main | 正在准备正式产物；发布完成后更新入口，保留 7.0 历史下载 |

所有画面、声音、输入、剪贴板和文件必须经 UDP P2P。UDP 无法直连时明确失败，禁止 TURN、ICE-TCP、FRP、HTTP 或 WSS 载荷回退。NAS/CLI 保持独立，不因无图形能力而报告可被控。

Windows 产品虚拟麦克风必须使用产品驱动及合法发行签名；macOS 使用 AudioServerPlugIn 和发行身份；Linux 使用 PipeWire 虚拟输入。测试替身、静音轨和编译成功均不能作为这些功能已可用的证据。

范围不含 Android 被控、登录前/UAC 安全桌面、跨账号共享、图片剪贴板、目录递归传输。现有用户数据与部署环境不用于破坏性验收。

完整门禁见 [IMPLEMENTATION.md](IMPLEMENTATION.md)，逐项结果见 [ACCEPTANCE.md](ACCEPTANCE.md)。

最新 [视频、双向文件和输入联合报告](evidence/windows-browser-files-input-margin-development.json) 通过真实文件字节与哈希、取消、权限撤销、已保存文件保护，以及随后键盘/中文/鼠标和旧代次拒绝；内部提前释放后，心跳释放为 1394 ms、worker 崩溃按键/鼠标约 76/77 ms。文件选择使用限定临时目录和浏览器私有文件系统，不能替代完整 OS 文件选择和最终安装包验收。

新增 [Windows→Chromium 真实输入报告](evidence/windows-browser-input-development.json)：键盘按下/释放、中文、鼠标、旧输入代次拒绝均通过；停止输入心跳后按键释放 1885 ms，终止 worker 后按键/鼠标释放约 44/46 ms。测试只向独立测试浏览器进程注入，经过真实签名配对、批准、UDP 和 DTLS。这是同机开发 worker 的实测，不能代替最终安装包、锁屏、高 DPI、多屏和跨网验收。

2026-09-23 开发检查点：远控协议 51 项、远控浏览器界面 7 项及桌面界面 14 项回归通过。文字提交现等待匹配 UUID 和输入代次的 `TEXT_ACK`，收到确认或明确失败后才释放该次输入；超时不会自动重发可能已经插入的文字。剪贴板通道等待已请求的启用确认，撤销会立即清除权限和缓冲；迟到确认不会重新授权。原生本机基础探针见 [windows-native-probe.json](evidence/windows-native-probe.json)。[Windows→Chromium H.264](evidence/windows-browser-h264-development.json) 与 [VP8](evidence/windows-browser-vp8-development.json) 各自经过真实签名配对、本机批准、peer proof、双端 UDP/DTLS 检查及持续 1920×1080 解码，并核对原生编码器与浏览器统计。两次均仅观看、同一台机器、客户端源码含未提交修改；不能用作最终发行包、输入、跨网或完整平台验收证据。

候选发布分为构建封存和验收后发布两阶段。先保留同一标签构建的完整安装包，再使用这些原始字节执行原生视频、键盘、中文、鼠标、心跳失联及 worker 崩溃验收，验证源提交、安装与便携包中的 worker 摘要一致，之后才能公开 Release。预备产物不能当作已验证发布；实际输入验收或两秒释放期限未通过时门禁保持失败。

新增局部证据：[Windows runner 构建](evidence/windows-runner-build-development.json) 在四核、四任务下用 27 分 44 秒完成源码准备、构建及检查；这是历史开发提交，不是最终候选包。[H.264](evidence/windows-native-h264-development.json) 使用 OpenH264→FFmpeg，[VP8](evidence/windows-native-vp8-development.json) 使用 libvpx，均在同机 UDP/DTLS 原生探针上实际解码 1280×720 视频。两者均为软件编解码，不证明浏览器、Android、硬件或跨网支持。H.264 曾因未编入 FFmpeg 解码器而失败；依赖构建已改为包含该解码器，失败记录仍保存在组件构建记录中。

API 候选契约已在服务端 PR #3 合并并通过主分支检查后冻结：[api-v1.2.0-rc.1](https://github.com/ZHanry/home-tunnel-server/tree/api-v1.2.0-rc.1) 对应提交 `9c54212b91d3bfac24aa5af4863dd2f8649fa5fe`。该标签仅冻结契约，不代表产品 RC 已发布；桌面与 Android 已同步不可变快照和实际 SHA256。
