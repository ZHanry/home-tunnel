# 8.0 验收记录

本表保留方案 2.0 的全部 68 项，并增加 12 项扩展验收。每行按完整预期判定；代码审查、单元测试或构建只能作为局部证据，不能把尚未执行的实机整体验收标记为通过。当前所有完整验收项及 40 个实际平台组合均未完成。

状态：`passed` / `failed` / `not_verified`。失败必须记录，禁止改写为未验证来绕过发布门禁。机器可读明细见 [acceptance.json](acceptance.json)。

| ID | 操作 | 必须观察到 | 完整验收 |
| --- | --- | --- | --- |
| A01 | 用户A请求用户B endpoint/session/grant | 不返回B存在性/在线/SDP；统一不可见 | 未验证 |
| A02 | 复制RD token到无私钥进程 | DPoP校验失败，不回退Bearer | 未验证 |
| A03 | 重放challenge、DPoP jti、signal ticket | 最多首次有效，后续拒绝且资源不增加 | 未验证 |
| A04 | 修改JWS typ/alg/kid/aud或使用任意jwk | 全部拒绝；不跟随远程key URL | 未验证 |
| A05 | admin尝试控制无本机授权host | 拒绝；admin只能管理和停止 | 未验证 |
| A06 | 账号密码已知，新建controller | 仍需host本地批准；旧授权不能套用到新公钥 | 未验证 |
| A07 | browser清站点数据/换浏览器/原生重装 | 新身份重新配对，不按名称自动恢复信任 | 未验证 |
| A08 | browser注册host或伪造linked_device_id | 服务端schema/owner/角色约束拒绝 | 未验证 |
| A09 | 普通隧道接入码/device credential请求他机列表 | 拒绝；原隧道管理继续正常 | 未验证 |
| A10 | 修改密码、退出父session、撤销设备、禁用用户 | 拒绝新票据/续租；在线host停止，离线不超当前lease | 未验证 |
| A11 | 服务端伪造扩大grant/回滚grant版本 | host本地不接受，输入不开放 | 未验证 |
| A12 | OS密钥存储失败/浏览器不可持久化 | 明确受限/临时身份；无明文私钥悄悄落盘 | 未验证 |
| A13 | Web跨站请求、错误Origin、CSRF缺失、多标签并发 | 未授权操作失败；标签不互踢无限重连 | 未验证 |
| A14 | 本机点击“关闭被控”或“立即停止”且服务器不可达 | 当地立即停止捕获和输入，不等待远端确认 | 未验证 |
| S01 | 并发重复创建/批准/renew，同幂等键不同body | 同请求同结果，不同body 409，不超槽 | 未验证 |
| S02 | host/controller双角色同时占位、两个controller争host | 唯一slot保证最多一个活动占位，失败请求不泄漏资源 | 未验证 |
| S03 | 发出票据前数据库commit失败/磁盘满 | 不把未持久化授权发出，不创建幽灵lease | 未验证 |
| S04 | active中server进程崩溃重启 | slot从持久化恢复；未过期直连可继续，不重复放行名额 | 未验证 |
| S05 | server离线跨过lease到期/调系统时钟回退 | 最晚按原到期停止，不能重新起算900秒 | 未验证 |
| S06 | controller谎报close立刻申请新会话 | 原槽在host确认或lease过期前保留 | 未验证 |
| S07 | 信令连接旧generation晚到close回调 | 新连接presence不被误标离线 | 未验证 |
| S08 | 超大/碎片/慢消费者/未知type/重复候选 | 消息与内存上限生效，旧服务不崩溃 | 未验证 |
| S09 | 账号日业务字节耗尽 | 禁止新会话；安全关闭仍可执行；保留预算不能传任意数据 | 未验证 |
| S10 | 同时已有 `/api/v1/ws` 和新RD WSS | 两者各自正确升级/鉴权；旧handler不误关新socket | 未验证 |
| S11 | 当前7.0访问新8.0、8.0访问旧服务端 | 支持策略与capability准确；隧道回归通过，新RD有清楚不可用提示 | 未验证 |
| S12 | 从旧备份恢复、旧kid轮换、未知kid | restore_epoch与信任规则执行，旧撤销不复活，未知key安全失败 | 未验证 |
| P01 | 配置注入turn/turns或ICE-TCP | 启动/创建会话拒绝；不能静默改用 | 未验证 |
| P02 | SDP/trickle出现relay、TCP、非法地址或超数 | 严格拒绝/受控剔除；host不进入敏感业务 | 未验证 |
| P03 | 合法prflx、IPv6、RFC1918/ULA、mDNS host | 受支持库正常处理；不能全拒私网或所有域名 | 未验证 |
| P04 | 建连后路径变化为不合规/不可验证 | 先停输入/画面，再验证或终止；UI不保持旧P2P标识 | 未验证 |
| P05 | 禁止UDP/不可穿透NAT | 20秒内结束本轮；无FRP/WSS/HTTP媒体回退 | 未验证 |
| P06 | 服务器抓包，视频分别10/40Mbps | 无媒体/输入转发，服务器带宽不随视频线性增加 | 未验证 |
| P07 | STUN Allocate/Refresh/ChannelData/Send、端口扫描 | TURN不可用，无relay端口暴露；只开放必要UDP入口 | 未验证 |
| P08 | STUN Binding洪泛、伪源/大量来源桶 | 限速与内存/出站预算有效，无无限错误放大；不声称网卡入站零流量 | 未验证 |
| P09 | STUN关闭/单IP故障，LAN/IPv6可达 | 可用直接候选按真实能力工作；否则明确失败，不转公共服务 | 未验证 |
| P10 | Wi-Fi↔蜂窝、WSS与UDP不同出口 | 按epoch恢复/失败；不因错误IP绑定否认合法身份 | 未验证 |
| P11 | 重放旧epoch的offer/candidate/input/异步回调 | 不作用于新PC/新输入，配额仍是原session槽 | 未验证 |
| P12 | 管理服务器仅IPv4，两端IPv6互通 | 控制面可达时可测IPv6直连；控制面不可达时明确新会话不可用 | 未验证 |
| M01 | H.264 profile/level/尺寸不兼容 | 正确协商或报错；不声称任意浏览器支持HEVC | 未验证 |
| M02 | 禁用/失效硬件codec、跨GPU捕获 | 报告实际路径；显式软件/低规格回退或失败，无伪硬编 | 未验证 |
| M03 | 静态桌面→快速滚动→视频→静态 | 队列有界、质量自适应，无持续高空闲编码 | 未验证 |
| M04 | 丢关键帧、RTX过期、持续拥塞 | 有限关键帧恢复，无无限重传/关键帧风暴 | 未验证 |
| M05 | 同分辨率切另一屏、迟到旧帧 | 遮罩/重建与layout门保证不在旧画面位置误操作 | 未验证 |
| M06 | Windows锁屏/UAC/GPU reset | 正确暂停/限制提示，恢复资源，无关闭UAC行为 | 未验证 |
| M07 | macOS首次安装/TCC拒绝/撤销/Retina | 权限引导与状态准确，坐标正确，旧授权不冒充新包权限 | 未验证 |
| M08 | GNOME/KDE Wayland分别授权/取消/restore | capture/input同一Portal会话，取消立即释放，无root绕过 | 未验证 |
| M09 | Android旋转/Surface销毁/后台/发热 | 无旧Surface输出，不无限建codec，热降频合理降档 | 未验证 |
| M10 | Chrome/Edge/Firefox/Safari隐藏统计或保留键 | 诊断如实标未知/host验证；工具栏有效、没有强行劫持承诺 | 未验证 |
| I01 | 按住Ctrl/Shift/鼠标拖拽突然断网 | 2秒内释放；随后旧可靠KEY_DOWN不复活 | 未验证 |
| I02 | 丢失最后移动包后点击、乱序movement | BUTTON自带位置，点击正确，旧motion水位被拒绝 | 未验证 |
| I03 | 高DPI/负原点/旋转/黑边/缩放/平移 | 统一变换正确；黑边不触发边缘误点 | 未验证 |
| I04 | 中文拼音、组合文字、emoji、代理对、重复提交 | 仅最终文字提交，UTF8完整，ID去重，失败不ACK成功 | 未验证 |
| I05 | Linux不同XKB/IBus/Fcitx环境 | 记录明确text模式；受支持中文路径通过，不能用未授权剪贴板代替 | 未验证 |
| I06 | 实体键盘左右修饰键/快捷键/长按 | 正确KeyId映射与重复，不出现双重文字路径 | 未验证 |
| I07 | 相对运动中丢包/乱序/大幅增量 | 累计值恢复，异常拒绝，切模式重新同步 | 未验证 |
| I08 | 用户失焦/退出全屏/手机手势取消/浏览器冻结 | 及时释放控制权，host看门狗兜底 | 未验证 |
| I09 | 新layout/input_epoch下迟到旧指针/文本 | 严格拒绝，不能在新布局输入旧动作 | 未验证 |
| I10 | 只看模式伪造input/text、未经握手输入 | 拒绝并有限审计，不能因DataChannel已open而放行 | 未验证 |
| O01 | 启用/关闭RD前后访问HTTP/TCP/UDP/RDP预设 | 原流量路径与权限语义不变，现有测试通过 | 未验证 |
| O02 | worker崩溃/ABI错误/恶意IPC/本地网页攻击 | worker安全失败，旧隧道继续，无任意命令/签名接口 | 未验证 |
| O03 | 升级中断/manifest篡改/包哈希错误/签名错误 | 原有更新保护继续生效，父子组件不混版本 | 未验证 |
| O04 | 数据库/密钥一致性备份→干净卷恢复 | 可恢复，旧session撤销，restore_epoch正确，host授权仍由本机决定 | 未验证 |
| O05 | 关闭RD回滚、旧镜像误指新schema | 功能关闭可用；不允许未经验证的数据库降级 | 未验证 |
| O06 | 日志/诊断导出/指标标签检查 | 无画面、文本、按键、完整SDP/token；基数有界 | 未验证 |
| O07 | 实际安装/卸载/自启/账号退出 | 单安装包，权限提示合理，卸载清理含用户选择，旧隧道数据不误删 | 未验证 |
| O08 | Android现有正式包升级 | applicationId/证书不变，原多服务器账户可用，新增native ABI完整 | 未验证 |
| O09 | CLI/NAS构建与无图形环境运行 | 无GUI/媒体依赖要求，不误报可被控 | 未验证 |
| O10 | 发布清单/下载/校验/SBOM/签名核对 | 产品/协议/引擎版本一致，签名状态如实标明 | 未验证 |
| E01 | 四个控制窗口并发；关闭、重连和切换焦点 | 四会话名额生效；只有焦点窗口接收输入；其他窗口持续可用 | 未验证 |
| E02 | 系统声音未授权、授权后启动和中途撤销 | 独立Opus音轨；默认静音；撤销立即停止捕获与输出 | 未验证 |
| E03 | 两个会话争用麦克风、后台与关闭 | 仅显式指定的一个会话收到；关闭清缓冲并静音 | 未验证 |
| E04 | Windows产品虚拟麦克风安装/升级/卸载 | 有效发行签名；目标应用可选择；权限及失败反馈准确 | 未验证 |
| E05 | macOS AudioServerPlugIn与Linux PipeWire虚拟输入 | 目标应用可选择；独立授权；安装卸载和失败恢复可验证 | 未验证 |
| E06 | 同文双向复制、重复ID、前后台、超长中文 | 文本64KiB上限；去重无回环；只作用于指定且被授权会话 | 未验证 |
| E07 | 多文件、慢盘、空间不足、重名、用户取消 | 显式目标；最多2并发；逐块确认；不覆盖未授权文件；失败不报告成功 | 未验证 |
| E08 | 篡改块/顺序/长度/最终hash及连接丢失 | SHA256和偏移验证；中止并清理未提交文件；不自动恢复旧传输 | 未验证 |
| E09 | AV1/HEVC缺失硬件、失败、能力冲突 | 依据真实能力协商；H264/VP8明确回退；报告实际encoder/硬编状态 | 未验证 |
| E10 | 7.0→多个8.0 RC→8.0正式版连续升级与回滚 | 组件版本一致；升级前停止远控释放输入；Android签名不变且versionCode递增 | 未验证 |
| E11 | 签名keyset连续轮换、未知kid、回滚与恢复 | 从旧pin逐版验证；拒绝换根和倒退；restore_epoch变化清旧会话 | 未验证 |
| E12 | RC清单、真实下载、摘要、SBOM、报告与稳定入口 | 四仓实际不可变产物齐备；限制如实；7.0稳定入口不被RC覆盖 | 未验证 |

## 40 个基础互通组合

| 控制端 | Windows | macOS | Linux X11 | GNOME Wayland | KDE Wayland |
| --- | --- | --- | --- | --- | --- |
| Windows Chrome | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 |
| Windows Edge | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 |
| Linux Firefox | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 |
| macOS Safari | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 |
| Windows desktop | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 |
| macOS desktop | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 |
| Linux desktop | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 |
| Android physical device | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 |

每个平台还需 2 小时活动和 24 小时在线记录，以及 GPU/架构、中文输入、系统权限、弱网、Wi-Fi/蜂窝切换、跨 NAT/IPv6 与服务器抓包证据。当前没有这些真实记录。

## 已有局部自动化证据

- 释放调度余量：[加固后的联合报告](evidence/windows-browser-files-input-margin-development.json) 保持视频、文件、取消/撤销及全部输入场景通过；心跳释放 1394 ms，worker 崩溃按键/鼠标约 76/77 ms。内部提前释放为系统调度留余量，对外两秒验收标准未放宽；仍为开发 worker，最终封存包需要单独报告。
- 视频、文件和输入联合验证：[最新开发报告](evidence/windows-browser-files-input-development.json) 记录真实 H.264/UDP 视频、双向空文件和超过 1 MiB 的文件、实际磁盘字节与 SHA256、取消/撤销、已保存文件不被删除以及视频持续；之后键盘、中文、鼠标、旧代次和 worker 崩溃释放仍通过。该次心跳释放为 1982 ms，崩溃释放约 68/74 ms；内部调度余量仍在加固，最终包需重测。文件选择使用隔离测试目录与浏览器私有文件系统，不代替完整 OS 选择器验收。
- Windows 真实输入：[开发报告](evidence/windows-browser-input-development.json) 记录独立浏览器目标中的可信键盘/鼠标事件、精确中文结果、旧输入代次拒绝；心跳中断释放 1885 ms，worker 崩溃释放按键/鼠标约 44/46 ms。系统屏幕选择器退出后该次实测通过。源码未封存，最终包及完整 I01/I04/I09 场景仍需验收；未把单机局部结果提升为完整条目通过。
- 浏览器：43 项协议测试涵盖严格消息 schema、真实公开签名向量、密钥链、候选检查、单调租约、输入心跳与授权代次、流式文件和文本剪贴板；包括文字确认 UUID/代次校验、拒绝、超时、不自动重发及旧请求清理不释放新授权；剪贴板跨通道授权、取消、迟到回复与非法文本回归通过；7 项远控界面回归通过。
- Windows→Chromium：[开发视频报告](evidence/windows-browser-view-development.json) 记录真实配对和本机授权、UDP/DTLS 与持续 1920×1080 解码。仅限同机观看；源码未封存，输入、系统声音、文件等未由此验证。
- 产品编码互通：[H.264 开发报告](evidence/windows-browser-h264-development.json) 和 [VP8 开发报告](evidence/windows-browser-vp8-development.json) 分别约束真实 Chromium 的视频能力，核对实际接收编码与原生编码器统计，均通过 1920×1080 UDP 视频。H.264 为 OpenH264，VP8 为 libvpx；浏览器未提供的解码器/硬件统计保持 null。仍是同机观看开发证据，不代表实机完整矩阵或最终包。
- STUN：[实际容器报告](evidence/stun-runtime-development.json) 来自 [GitHub 隔离运行](https://github.com/ZHanry/home-tunnel-server/actions/runs/35756694517)。修复启动失败后，锁定的 coturn 镜像通过 Binding、Allocate/Refresh/CreatePermission/ChannelBind 拒绝、Send/ChannelData 本地不转发、TCP/TLS 无监听及 nftables 检查。60 个短时 Binding 请求接收 20 个，丢弃计数 46（含其他拒绝请求）。该报告只证明隔离 Linux namespace，不证明公网、IPv6、Docker DNAT 或云端计费负载结果。
- 服务端、桌面和 Android 的自动化结果由各仓库 CI 和组件开发报告保存；统一候选报告必须绑定最终提交与产物摘要。
- 原生编解码：[H.264](evidence/windows-native-h264-development.json) 和 [VP8](evidence/windows-native-vp8-development.json) 分别在同机 UDP/DTLS 探针上实际解码 30 帧；软件路径及编码器名称已记录。不是产品浏览器互通、硬件编码或跨网验收。
- 原生构建：[Windows runner 记录](evidence/windows-runner-build-development.json) 绑定成功 CI 的历史提交、worker 摘要、初始磁盘和构建用时。授权与守护进程生命周期测试通过，没有执行真实按键注入；当前输入实测被系统屏幕选择器遮挡，发布门禁仍未通过。
- 这些结果不证明完整平台功能、真实网关穿透或最终发行安装包已通过验收。
