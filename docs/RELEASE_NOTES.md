# NestLink 14.0.1 维护版

本版修复 Linux 正常首页缺少“版本与下载”入口的问题，复用客户端既有品牌及偏好菜单。四仓按现有发行组合统一升级为 14.0.1；Android versionCode 为 14000100，安装身份、证书、冻结认证 API 与设备能力扩展保持不变。

本版 14.0.1 三个组件的真实 GitHub Release、原始文件 SHA-256、确切源提交及 Sigstore 签名已独立核验。稳定通道和下载清单绑定这些发行字节。各组件实际验收范围如下；14.0.0 原始记录和下载保留为历史记录。

- **server**: Exact C build provenance and payload hashes are verified. The original candidate checksum Sigstore signature and immutable application image signatures are verified. Formal Release Materials and stable/latest tag resolution are verified separately after publication. Pending installed-product remote, authorization, account and tunnel runtime scenarios are not_run after the owner requested direct publication. The Android C overlay is the sole passed required installed-product scenario. Existing local Linux overlay evidence remains a separate completed check. No production server deployment or Windows reinstallation is performed.

- **client**: Exact C build provenance and payload hashes are verified. Client exact-source CI provenance and payload hashes are verified. The Windows installer has no Authenticode signature. Formal Materials Sigstore verification is performed separately after publication and cannot replace platform executable signing. Pending installed-product remote, authorization, account and tunnel runtime scenarios are not_run after the owner requested direct publication. The Android C overlay is the sole passed required installed-product scenario. Existing local Linux overlay evidence remains a separate completed check. No production server deployment or Windows reinstallation is performed.

- **android**: Exact C build provenance and payload hashes are verified. The actual APK retains the original Android signing certificate d7779e338be1039acee6dda9a43417cbf2baf4b0c9995578d9708501e95af702. Formal Materials Sigstore verification is performed separately after publication. Pending installed-product remote, authorization, account and tunnel runtime scenarios are not_run after the owner requested direct publication. The Android C overlay is the sole passed required installed-product scenario. Existing local Linux overlay evidence remains a separate completed check. No production server deployment or Windows reinstallation is performed.

本版组件验收保留的未测索引：`account-login-management`、`account-migration`、`account-revocation`、`browser-authorization`、`browser-screen-input`、`carrier-network-nat`、`current-c-product-ui-matrix`、`installed-native-p2p`、`local-windows-14.0.1-reinstallation`、`long-duration-media`、`managed-tunnels`、`native-authorization`、`native-remote-control`、`physical-android-device`、`physical-linux-arm64-gui`。历史验收结论不替代本版；正在运行的生产服务端保持原版本。

状态：accepted_with_waivers。用户授权原话：`不需要远控回归,直接做后面的`。未执行的运行时场景不宣称通过：

- server/account-migration: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.
- server/browser-authorization: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.
- server/managed-tunnels: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.
- server/native-authorization: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.
- client/account-revocation: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.
- client/browser-screen-input: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.
- client/installed-native-p2p: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.
- client/managed-tunnels: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.
- android/account-login-management: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.
- android/native-remote-control: not_run — The owner stopped pending remote-control regression and requested direct publication. This unfinished runtime scenario remains not_run; exact-source CI and payload/signature verification do not constitute installed-product runtime acceptance.

Hub `current-ui-site`：not_run，本版 C 产品真实界面回归未执行；网站布局、下载字节和签名另行实际检查。官网产品截图保留真实14.0.0来源、原始manifest和摘要；14.0.1产品UI回归为not_run。Website product screenshots retain their actual 14.0.0 source, original manifests and hashes; 14.0.1 product UI regression remains not_run.

原 14.0.0 标签、附件和失败记录均保留。发行后确认 Linux 版本入口不可达，Android AVD 被控媒体失败，仍有 18 项 open 依赖告警（3 high、7 medium、8 low）。这些限制不能因版本同步而宣称解决。历史完整说明见 [v14.0.0 发行文档](https://github.com/ZHanry/home-tunnel/blob/v14.0.0/docs/RELEASE_NOTES.md) 与 [14.0.0 验收记录](release/acceptance-14.0.0.json)。

本版已知问题与未测范围：服务端中文远程协助页的密码提示仍显示英文 “Optional; the host can approve instead”。实体 Android、Linux ARM64／Wayland 实机、Windows 本机 14.0.1 安装与 GUI、运营商 NAT 和长时媒体均未测试；Windows 本机验证为 `not_run`（本机维护不重装），安装器仍无 Authenticode。Android 被控、PIN 和 `trusted_devices` 的既有限制及 18 项 open 依赖告警仍保留，不能因版本同步而宣称修复。线上生产服务端保持原版本。

Known limitations and untested scope for 14.0.1: the password hint on the Chinese server Remote assistance page still reads “Optional; the host can approve instead”. Physical Android, Linux ARM64 and Wayland hardware, local Windows 14.0.1 installation and GUI, carrier NAT and long-duration media were not tested. Local Windows validation is `not_run` because this maintenance task does not reinstall it; the installer still has no Authenticode signature. Existing Android receiver, PIN and `trusted_devices` limitations and the 18 open dependency alerts remain; version alignment does not establish that they are fixed. The production server remains on its existing version.

## NestLink 14.0.0 历史发行

NestLink 14.0.0 以桌面 update11 为基准，统一 Windows、Linux、服务端 Web 与 Android 的名称、客户端 SVG Logo、紫色主题、业务图标及“设备管理、远程协助、内网穿透”入口。Web 和 Android 按浏览器、手机与平板的真实能力呈现导航与账号入口。

设备按明确能力关联归并物理设备，分别展示远控与穿透状态；同名设备独立，完整目录取得后再归并、筛选与分页。远控和穿透使用各自能力主体；普通删除原子撤销整机能力并保留服务配置，管理员永久删除独立确认并检查权限。冻结认证 API v2、安装身份、配置命名空间、Android applicationId、原发行证书及安全凭据机制保留；旧服务端缺少扩展时明确降级。产品和受管运行时为 14.0.0，Android versionCode 为 14000000。

## 确切来源与构建

本版 Hub 发行标签为 `v14.0.0`。已接受站点源为 `0e45aeffbf09ee9249d5a1ab55e0ecf723d9d082`，确切成功 Pages 构建为 [38119530254](https://github.com/ZHanry/home-tunnel/actions/runs/38119530254)。本页记录该站点源的真实验收，完整索引见 [acceptance-14.0.0.json](release/acceptance-14.0.0.json)。

| 组件 | 正式 v14.0.0 标签源 | 实际已测载荷源 | 原始已接受 CI |
| --- | --- | --- | --- |
| 服务端 | `fa765744ce56076fcde364f1f11749cfe77a744a` | `299753a4c6580ac6bbc748cdee743489a3e17dba` | [38053932107](https://github.com/ZHanry/home-tunnel-server/actions/runs/38053932107) |
| 桌面客户端 | `46e6194b5e0474292a175b6247b36572434fa9a4` | `feaf1181efe55076dead52931203a8488cbad20d` | [38069751230](https://github.com/ZHanry/home-tunnel-client/actions/runs/38069751230) |
| Android | `a4a96b66208483b9e85f1f6dcf6298397de57e22` | `dcdfc4299d1f92f46b5f3ca8e675d304f9639982` | [38069852456](https://github.com/ZHanry/home-tunnel-android/actions/runs/38069852456) |

Android 共享 core 固定实际客户端载荷 `feaf1181efe55076dead52931203a8488cbad20d`。三个正式组件标签相对原始构建来源仅有本版验收 JSON 与两份发行文档差异；公开产物、签名和源码绑定使用各自实际验收来源。Windows 安装器没有 Authenticode；来源签名与平台代码签名分别记录。FRPS 使用独立 0.70.1-r4 固定签名依赖。

## Hub 实测范围

已完成本站 8 个中英文页面、11 个真实组件附件与下载/稳定更新清单绑定、缓存版本及 no-store 检查，使用 8 份实际安装产品原图，并完成确切 148 个 `ready.default` 本地浏览器场景：captured 148、pending 0，非合成网络状态，完整原始切片与全部已追踪站点字节均与已接受源绑定。

原始矩阵清单 SHA-256：`ac8455db1e49f39620773817a84f9038260eef4a04005ae16ae1eb38601c54a1`。组件主件 SHA-256：`69c4a0f6cf44d4c2c19015f7b50bd6b0a42f1b281dc862d209f6046eff2a7137`；站点主件 SHA-256：`4b9477387ae798293746e65ef1673bff55cc9eab7ca3997c485db0e5a65b298c`。这些检查衡量站点布局、交互和发行字节，产品媒体验收范围按下面各组件正式记录披露。

实际 Hub 验收 scope 原文：

> Frozen 14.0.0 Hub distribution/site only: genuine complete published Server/Client/Android attachment bytes, SHA-256, signed BUILD/source and documentation-only formal tag drift; exact original payload mappings and Android core; 8 bilingual pages, 11 component attachments, stable update/cache projections, 8 unchanged installed product originals with hash-bound reviews, and 148 completed local Chromium/Edge layout cases against every tracked served site byte. These Hub checks do not rerun product media or claim production deployment.

官网保留 Windows 登录、Linux 设备管理/远程协助/内网穿透、Web 管理工作台/远程协助/穿透向导与 Android 设备管理的原始像素，标明平台及实际载荷来源。图片使用隔离任务账号和设备；Linux 原图显示的旧一次凭据已由实际 GUI 旋转，其动作回执绑定确切原图，旋转后凭据不公开。截图仅证明当时 UI。

| 原图 | 实际载荷源 | 图片 SHA-256 | 原始清单 SHA-256 |
| --- | --- | --- | --- |
| Windows 登录 | `feaf1181efe55076dead52931203a8488cbad20d` | `92f8caba817a872d2f199f6b421e7816315d3ceb48bbe0096cd6403f1a02e82c` | `82f730329a4fc663e645531040e3adb1dd45e061568d2ef6521356c2cd25b9ac` |
| Linux 设备管理 | `feaf1181efe55076dead52931203a8488cbad20d` | `553adb81b802ea40f49209dd03d79d94e3eb9cc8fe1005118eb0e1041a200df1` | `c0b865adbb4bf7566c77ce87ee741e38347910a0b10f82ee6443cbdf5e84249c` |
| Linux 远程协助 | `feaf1181efe55076dead52931203a8488cbad20d` | `761caa4b56575ddd8e556f52b0a8a28b06cf36ee36d06fbd126a4385aa744ba1` | `6858afb4117ec731c438240cd0bb724172b2ab496f9f7c83291114ab3291ac10` |
| Linux 内网穿透 | `feaf1181efe55076dead52931203a8488cbad20d` | `ad53b6a134bd2d58f7103f79856410e215ac26af8e149a521b58972e87528d76` | `a5a65607aef8174428288aa4c499ff6b3b01cd6cbc3aff4c7b197a70fe8f5517` |
| Web 管理工作台 | `299753a4c6580ac6bbc748cdee743489a3e17dba` | `5c775d6bd5f9fc148bfae0624dd50ee0d404a70e177ed9e448634440d5a126b5` | `2118151f9f75545d8a87b512339efafb22d2f63e2fdff55f8d72613978250429` |
| Web 远程协助 | `299753a4c6580ac6bbc748cdee743489a3e17dba` | `ca90ce27240f2f2accce75038591cafaa76925f3c85bc8a14967e1560a70db7f` | `c8a5c682e3323742d0a4471a09c9b8313a76b302585612e718808849564a3132` |
| Web 穿透向导 | `299753a4c6580ac6bbc748cdee743489a3e17dba` | `6fcdf1942f3194e1bccb59f37f10568ddbc49f7b954f7b15f25017a99b338a46` | `c8a5c682e3323742d0a4471a09c9b8313a76b302585612e718808849564a3132` |
| Android 设备管理 | `dcdfc4299d1f92f46b5f3ca8e675d304f9639982` | `59ac2d34de55e85c26dabb7c30228276740c243e7adb418dfc6ed070cd5daf5d` | `231088053811cc2a4def50a097dcc40a226534f1fb917e28e6876b93acfa2725` |

## 组件实际验收与限度

### 服务端

正式来源说明：[docs/RELEASE_NOTES.md](https://github.com/ZHanry/home-tunnel-server/blob/fa765744ce56076fcde364f1f11749cfe77a744a/docs/RELEASE_NOTES.md)。以下正文保留该来源内容，验收链接展开为确切提交。

服务端 Web 与桌面、Android 统一 NestLink 品牌、客户端 SVG Logo、紫色主题、图标和“设备管理、远程协助、内网穿透”导航。语言、主题和版本集中在顶部，账号入口在导航底部；管理员总览、用户、审计和系统策略保留在管理区。登录、首次改密、设备、穿透编辑与详情、账号和会话界面使用一致控件与中英文名称。

迁移 026 和 `nestlink-device-capabilities-v1` 版本扩展按明确关联显示物理设备，分别展示远控与后台能力，同名设备独立。管理员全域能力查询仅允许管理员读取，按账号关联；远控和穿透分别使用自己的主体。普通删除原子撤销两种能力并保留服务配置，永久删除仍单独确认和校验权限。冻结认证 API、安装身份和安全凭据机制保持兼容。

发行复用源提交 `299753a4c6580ac6bbc748cdee743489a3e17dba` 的 [Server CI 38053932107](https://github.com/ZHanry/home-tunnel-server/actions/runs/38053932107) 已验收产物。正式标签相对构建来源仅追加本版验收 JSON 和两份发行文档。详细来源、执行时间、原件摘要及未测范围见 [acceptance-14.0.0.json](https://github.com/ZHanry/home-tunnel-server/blob/fa765744ce56076fcde364f1f11749cfe77a744a/docs/release/acceptance-14.0.0.json)。

| 产物 | 已验收摘要 |
| --- | --- |
| NestLink-Server-14.0.0.tar.gz | `1a42bc2e9520c9d4d7c641af6bc3fff42bd9833880423b767485779f4e8812a7` |
| control-center | `sha256:b6e43b72494cca541c023b366e27504a46ac1acea0ec4c504adb4f15a6b0cb46` |
| traffic-gateway | `sha256:8c07824ea38e5cf2297ad0ff80711c90f688b1a82f7fe9dc62d406a9328515cb` |
| FRPS 0.70.1-r4 | `sha256:69dd1e9a05dbef35f44436db77f88e266a2772d57a86f889ffbd982ca7798ddb` |

control-center 和 traffic-gateway 提供 Linux amd64/arm64 镜像，候选清单、部署包和镜像签名均独立验证；FRPS 使用单独签名的固定依赖。本地完整联调为 amd64，CI 双架构构建及 smoke 不代表本机 ARM64 完整运行。

迁移验收使用活动数据库的 SQLite 备份副本，在副本移除 026 对象后进行 schema25→26 重放，公开 13.0.0 镜像启动后升级到确切 14.0.0 镜像。5 台设备身份/凭据和 1 个服务配置摘要保留，活动数据库和生产部署没有升级。服务端六项授权、事务回滚和删除 API 检查，以及四项真实网页目录、权限和窄屏布局检查独立保存；37 个实际静态资源与源码及镜像绑定。历史服务端单独检查没有重新标记为后来 feaf/dcdf 消费者参与。

本轮新客户端 `feaf1181efe55076dead52931203a8488cbad20d` 实际完成原生跨账号批准、紫色工具栏、真实画面、键盘标记和反向 TCP 端点配对。再次建立连接后撤销前台管理会话，远控连接消失，两种设备主体仍有效，HTTP、HTTPS 后端、TCP、UDP 四种穿透仍通。随后整机原子撤权使两主体、租约和所属会话失效，四种协议全部阻断。服务配置、其他同账号设备及其他账号授权状态保持。真实三阶段结果和任务 raw-tunnel 策略恢复原件分别保存。

浏览器批准、拒绝、错误密码、离线目标、管理会话撤权和正确固定密码六项实测通过。允许场景有真实画面和键盘输入，拒绝场景零画面并关闭连接，撤权返回 204 后 27 毫秒内断开。测试使用任务私网 STUN-only 后端与认证加密直连 UDP；118 个原件、失败尝试和单独范围记录保留。

新客户端对独立签名 13.0.0 服务的五项兼容检查通过，包含缺失扩展降级、明确配对与同名设备、主体选择及保留配置的旧接口删除。独立 UID1004/display144 的 32 次实际操作、原图和路由审计作为独立兼容范围，不覆盖 13 服务的媒体或穿透流量。Linux 13→14 的确切包冷恢复与 profile 保留另行记录，前置 profile 最初由早期 14 测试建立。

B 密码设置使用既有 root-admin IPC 临时 PIN 和真实 GUI。最初设置 PIN 的严格检查仍失败，因为额外 trusted_devices 变化的原语义未知；后续读取和清理通过，只清空 unlock_pin，A/root 配置保持。GUI 已恢复本机确认并锁定设置，测试固定密码保留。系统 root 密码 GUI 解锁未验证。

隔离联调使用 WSL X11、自签 TLS、host-network 健康 URL 适配、localhost 桥、HBBS LAN mask 和 STUN-only 后端。部分 API/Web 场景跳过任务自签证书验证，原故障与恢复记录保留。Windows/WSL 原始时间戳不改写，历史迁移结束时间的两个时钟域相差 3.394682 秒；未找到独立原始 GBK traceback 的证据限制继续披露。

Windows/ARM64/Wayland 媒体、Android 真机、Android ARM64 运行、模拟器被控媒体、运营商 NAT、长期媒体、公开 CA/生产 TLS、音频、剪贴板、文件传输以及本轮未执行的完整备份恢复仍未验证。Android 已通过的媒体方向为手机控制 Linux；模拟器 slirp 内部地址导致反向测试失败，未修改产品安全策略或原安装归属。

本次更新 GitHub 发行、下载站和自动更新信息，生产服务端继续运行原版本。14.0.0 使用自己的验收记录，13.0.0 历史结论单独保留。

### 桌面客户端

正式来源说明：[docs/RELEASE_NOTES.md](https://github.com/ZHanry/home-tunnel-client/blob/46e6194b5e0474292a175b6247b36572434fa9a4/docs/RELEASE_NOTES.md)。以下正文保留该来源内容，验收链接展开为确切提交。

以桌面 update11 为基准，统一 Windows、Linux、服务端 Web 和 Android 的 NestLink 名称、客户端 SVG Logo、紫色主题、图标及“设备管理、远程协助、内网穿透”入口。设备目录按明确能力关联显示物理设备，分别展示远控与穿透状态；同名设备独立，取得完整目录后再归并、筛选和分页。旧服务端缺少扩展时显示兼容降级状态。

远控与穿透分别使用各自的能力主体。普通设备删除原子撤销整机两种能力并保留服务配置，管理员永久删除仍单独确认并检查权限。保留自建 HTTPS 账号、记住登录、短期签名许可和认证加密 P2P 直连，以及安装身份、配置命名空间和冻结认证协议。产品与受管运行时升级为 14.0.0。

正式发行复用源提交 `feaf1181efe55076dead52931203a8488cbad20d` 的 [CI 38069751230](https://github.com/ZHanry/home-tunnel-client/actions/runs/38069751230) 确切产物。该来源的质量、安全与完整构建材料已验证；正式标签相对构建来源仅增加本版验收 JSON 和两份发行文档。完整实测索引见 [acceptance-14.0.0.json](https://github.com/ZHanry/home-tunnel-client/blob/46e6194b5e0474292a175b6247b36572434fa9a4/docs/release/acceptance-14.0.0.json)，本版单独记录来源、执行时间和原件摘要。

| 安装包 | SHA-256 |
| --- | --- |
| NestLink-Setup-14.0.0-x64.exe | `6f772544fef487c2b084f83abe26a9bfb581b4cd8aeebd25b2bcc5647ebda41f` |
| NestLink-Linux-14.0.0-x64.deb | `9856a8ac83da603847f6796c006df04fdc9c83f651b1014763e5df28a308a4ce` |
| NestLink-Linux-14.0.0-arm64.deb | `ad109bb5b1379c3a2cbfcf936ab83b35a1ce6d919126ae00d18c2a2e443662a3` |

Windows x64 实测备份、卸载、清配置、清装、启动和全部 115 个普通载荷文件，以及中英文深浅色登录界面。Linux amd64 使用公开 13.0.0 安装包核验实际载荷与冷恢复，再升级到确切 14.0.0 包，核验全部 100 个普通载荷文件及 A/B 配置、钥匙环保留。这些前置 profile 最初由早期 14 测试创建，本轮验证其在公开 13 载荷上的冷恢复和再升级保留，未追溯最初的历史 13 登录来源。

隔离 X11 双端实际完成跨账号批准、紫色工具栏、真实屏幕、键盘标记及两端反向 TCP 连接配对。新建连接后，前台管理会话撤销使远控断开，同时保留两种设备能力和 HTTP、HTTPS 后端、TCP、UDP 四种穿透。随后整机原子撤权使两主体与租约失效、四种协议全部阻断；服务配置、其他同账号设备和其他账号授权状态保持。原始批准、输入、断开和三阶段穿透结果均独立保存。

浏览器批准、拒绝、离线、错误密码、正确固定密码和会话撤权六项实际场景通过。允许场景收到真实画面并核验键盘输入；撤权返回 204 后 27 毫秒内断开。独立签名 13.0.0 服务上的新客户端兼容检查另行记录，覆盖缺失扩展降级、明确配对、同名设备、主体选择和保留配置的删除，未将其作为 14 服务的媒体或穿透证据。

测试 B 的密码设置通过既有 root-admin IPC 临时设置 PIN 后，再在真实 GUI 解锁和保存。首次设置 PIN 的严格检查仍为失败，因为同时发生 trusted_devices 变化且其原语义未知；后续独立读取与清理通过，仅清空 unlock_pin，A 与 root 配置未变。系统 root 密码 GUI 解锁未验证。失败回执、原始截图与独立审查保留。

本地媒体实测范围为 WSL amd64 X11 和 Chromium；Windows、ARM64、Wayland 媒体、实体 Android、运营商 NAT、长期媒体、音频、剪贴板及文件传输未在本轮覆盖。Linux ARM64 有独立 CI 构建与质量验证，没有本机 ARM64 执行。Linux 本轮原图审核覆盖中文浅色，Windows 已登录业务页未本地执行。Windows 安装器没有 Authenticode，来源签名与平台代码签名分别记录。

联调使用任务专用 WSL、自签 TLS、host-network 健康适配、localhost 桥、HBBS LAN mask 和 STUN-only 后端。部分 API/Web 场景跳过任务自签证书验证；任务网络恢复和 Android P2P 的精确临时单端口规则均单独记录。原始失败、时钟域与未测范围保留，13.0.0 验收结论不复用于本版。

依赖安全范围已针对确切构建材料核对。截至本次审查，客户端仓库仍有 18 个未关闭的 Dependabot 告警（3 high、7 medium、8 low）。`mio` 高危告警来自虚拟显示独立旧锁，本次 Windows/Linux/Android 选择的版本已超出受影响范围。Linux 的 `users` 0.10.0/0.11.0 未修复，冻结消费者未发现调用该高危告警涉及的组列表访问控制入口；这只是静态范围判断，没有动态可达性或利用测试。Linux 的 `libgit2-sys` 高危版本仍是读取冻结本地源码元数据的构建输入，其依赖链未选入受管运行时，该构建依赖没有修复。Linux glib、users 的其他告警以及 atty 风险仍保留；没有关闭或 dismiss 告警，也不宣称安装包没有受影响依赖。

The exact build materials were reviewed against the open dependency alerts. Linux still selects unpatched users 0.10.0/0.11.0; no calls to the affected group-list access-control entry points were found in the frozen consumers, without dynamic reachability or exploitation tests. The affected libgit2-sys remains a Linux build input and is not selected into the managed runtime. Selected Mio versions are outside its affected range. Other glib/users and atty risks remain; this release does not claim that all dependency vulnerabilities are fixed.

此次发布更新 GitHub、下载站及自动更新信息。正在运行的生产服务端保持原版本。

### Android

正式来源说明：[docs/RELEASE_NOTES.md](https://github.com/ZHanry/home-tunnel-android/blob/a4a96b66208483b9e85f1f6dcf6298397de57e22/docs/RELEASE_NOTES.md)。以下正文保留该来源内容，验收链接展开为确切提交。

NestLink 14.0.0 Android 与桌面端共用冻结的 Flutter/Rust 源码，统一紫色主题、Logo、设备目录和业务导航。保留 `io.github.zhanry.hometunnel` 与原发行证书；本版 `versionCode` 为 `14000000`。验收 APK 来源为 Android 提交 `dcdfc4299d1f92f46b5f3ca8e675d304f9639982`、共享客户端提交 `feaf1181efe55076dead52931203a8488cbad20d`，构建为 [Android CI 38069852456](https://github.com/ZHanry/home-tunnel-android/actions/runs/38069852456)。APK SHA-256：`0d81e4a2ac6ee64b21fd95bcae00ba3cbc71b9036371475786cc8bf03bcafbab`。

在 API 35 x86_64 隔离模拟器上，已实际从公开 13.0.0 APK 以原证书覆盖升级至上述确切 14.0.0 APK，核验安装身份、批准配置和受保护的记住登录数据保留。已核验 universal APK 的 ARM64/x86_64 原生库与签名；ARM64 硬件运行尚未测试。本次记录绑定 14.0.0 实际产物，没有复用 13.0.0 的验收结论。

UI 验收独立审阅 58 张原图及 58 份侧录，保留 143 次成功操作和 2 次失败操作。已记录页面覆盖中英文、明暗主题，手机 320/360/412dp、平板 760/1024dp、横竖屏、放大字体和软键盘；实际验证登录、账号切换后的目录隔离、Android 系统屏幕共享许可、共享通知及 InputService 授权。非阻断观察和状态覆盖边界保留在原始审阅中；刷新前后稳定布局的证据不代表连续加载过程全部已测。

原生媒体验收通过范围为 **Android 控制端 → Linux x64 被控端**，包含同账号和跨账号两次真实批准、收到画面、键盘输入，以及 Linux/QEMU/Android 三方进程拥有的确切 P2P 套接字和关闭后原媒体对消失。隔离环境使用真实 HBBS LAN 分类及短时、精确端口规则；没有媒体代理或中继，也没有修改产品安全策略。关闭同账号会话的截图处于确认前，真正关闭由确认后的独立套接字证据证明；工具执行前源码封存和首次 SYN 时序的已知证据边界如实保留。

Android 被控媒体在本轮 slirp 模拟器上未通过。三类尝试分别保存：Host 账号完整 ID 请求的 HTTP 404；Controller 请求因测试输入少末位而出现的 HTTP 404；恢复 Controller 并使用完整 ID 后，获得 `10.0.2.15` 内部候选而在批准前发生 P2P 失败。只读设备归属诊断没有实测 HTTP 409，也没有转移原安装身份。该被控方向及跨账号安装身份重新归属列为未验证范围，不宣称双向远控已通过。

原始截图和私有原生日志保留在本地验收目录，不能直接作为公开网站素材。物理 Android、ARM64 硬件、运营商 NAT、长期媒体、音频/文件/剪贴板媒体及完整状态和键盘焦点矩阵仍未验证。发布后的下载与更新发现由发行任务另行记录；此验收记录不包含生产服务端升级，线上服务保持原版本。

## 已记录的依赖安全范围

本版依赖安全范围已针对确切构建材料核对。已记录的客户端 Dependabot 查询仍有 18 个 open 告警（3 high、7 medium、8 low），没有关闭或 dismiss。`mio` 高危告警来自虚拟显示独立旧锁，本次 Windows/Linux/Android 使用的版本已超出受影响范围。Linux 的 `users` 0.10.0/0.11.0 未修复，且没有维护中的补丁版；冻结消费者未发现调用该 high 告警涉及的组列表访问控制入口，但这只是一项静态范围判断，没有动态可达性或利用测试。Linux 的 `libgit2-sys` 高危版本仍是读取冻结本地源码元数据的构建输入，其依赖链未选入受管运行时，并未修复这个构建依赖。Linux glib 的 medium VariantStrIter 风险未穷尽可达性，users 的其他告警与 atty 风险仍保留。不宣称安装包没有受影响依赖，后续替换依赖须重新构建并回归。

The dependency security scope for 14.0.0 was checked against the exact build materials. The recorded client query contained 18 open Dependabot alerts (3 high, 7 medium and 8 low); none were closed or dismissed. The high Mio alert comes from an old standalone virtual-display lock; the Mio versions selected for these Windows/Linux/Android artifacts are outside its affected range. Linux still selects unpatched users 0.10.0/0.11.0, with no maintained patched release. The frozen consumers do not call the group-list access-control entry points involved in its high advisory; this is a static scope finding, without dynamic reachability or exploitation tests. The affected libgit2-sys remains a Linux build input for metadata from the frozen local checkout; its dependency chain is not selected into the managed runtime, and the build dependency has not been remediated. Linux glib VariantStrIter reachability was not exhausted; other users and atty risks remain. This release does not claim to contain no affected dependencies or that all high alerts have been fixed.

公开参考：[客户端正式说明](https://github.com/ZHanry/home-tunnel-client/blob/46e6194b5e0474292a175b6247b36572434fa9a4/docs/RELEASE_NOTES.md)及 [NestLink-client-Materials-14.0.0.zip](https://github.com/ZHanry/home-tunnel-client/releases/download/v14.0.0/NestLink-client-Materials-14.0.0.zip)。以上披露来自本版已记录的确切材料审查，没有在生成本文时重新查询或关闭告警。

## 组件公开附件

以下 11 个附件与实际组件公开原件、确切来源和签名绑定，安装包、APK、部署包和 Materials 均保留其原始摘要。

| 组件 | 文件 | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| 服务端 | [NestLink-Server-14.0.0.tar.gz](https://github.com/ZHanry/home-tunnel-server/releases/download/v14.0.0/NestLink-Server-14.0.0.tar.gz) | 557130 | `1a42bc2e9520c9d4d7c641af6bc3fff42bd9833880423b767485779f4e8812a7` |
| 服务端 | [NestLink-server-Materials-14.0.0.zip](https://github.com/ZHanry/home-tunnel-server/releases/download/v14.0.0/NestLink-server-Materials-14.0.0.zip) | 2217610 | `fe10b6bb580197338e430cebcdcbad70e1bdae3d295ce45dce8bc09c9ead3ac4` |
| 服务端 | [SHA256SUMS.txt](https://github.com/ZHanry/home-tunnel-server/releases/download/v14.0.0/SHA256SUMS.txt) | 199 | `b586f224ebaaf7e46a2be223ba77d8ca91e12b2a65e879a9393631708b0c7125` |
| 桌面客户端 | [NestLink-Linux-14.0.0-arm64.deb](https://github.com/ZHanry/home-tunnel-client/releases/download/v14.0.0/NestLink-Linux-14.0.0-arm64.deb) | 33890582 | `ad109bb5b1379c3a2cbfcf936ab83b35a1ce6d919126ae00d18c2a2e443662a3` |
| 桌面客户端 | [NestLink-Linux-14.0.0-x64.deb](https://github.com/ZHanry/home-tunnel-client/releases/download/v14.0.0/NestLink-Linux-14.0.0-x64.deb) | 35797802 | `9856a8ac83da603847f6796c006df04fdc9c83f651b1014763e5df28a308a4ce` |
| 桌面客户端 | [NestLink-Setup-14.0.0-x64.exe](https://github.com/ZHanry/home-tunnel-client/releases/download/v14.0.0/NestLink-Setup-14.0.0-x64.exe) | 32020618 | `6f772544fef487c2b084f83abe26a9bfb581b4cd8aeebd25b2bcc5647ebda41f` |
| 桌面客户端 | [NestLink-client-Materials-14.0.0.zip](https://github.com/ZHanry/home-tunnel-client/releases/download/v14.0.0/NestLink-client-Materials-14.0.0.zip) | 1965325884 | `caa79d59b43dcdcaad184ebcfbac22096d03fab13c2d0e846906d94231e3c0c3` |
| 桌面客户端 | [SHA256SUMS.txt](https://github.com/ZHanry/home-tunnel-client/releases/download/v14.0.0/SHA256SUMS.txt) | 393 | `0141fd45d23b7b9176d769baa0e17b01049f8b0cce76d4077d7efede6edb9c49` |
| Android | [NestLink-Android-14.0.0.apk](https://github.com/ZHanry/home-tunnel-android/releases/download/v14.0.0/NestLink-Android-14.0.0.apk) | 118539831 | `0d81e4a2ac6ee64b21fd95bcae00ba3cbc71b9036371475786cc8bf03bcafbab` |
| Android | [NestLink-android-Materials-14.0.0.zip](https://github.com/ZHanry/home-tunnel-android/releases/download/v14.0.0/NestLink-android-Materials-14.0.0.zip) | 1134470998 | `bdaaf491c6969d15f8ddd78094a44c228e519638062cfbbc7fc1efec79701044` |
| Android | [SHA256SUMS.txt](https://github.com/ZHanry/home-tunnel-android/releases/download/v14.0.0/SHA256SUMS.txt) | 198 | `6df9261153373014d80cbe429dd5bd47c30180f3aa9c6e235be1f130eff874ae` |

Hub 验收保留的 unverified 索引：`OS-root-password-UI-unlock`, `android-arm64-physical-execution`, `android-receiver-media-on-task-slirp-avd`, `arm64-hardware-execution`, `audio-clipboard-file-transfer`, `audio-file-clipboard-media`, `carrier-network-NAT`, `carrier-network-nat`, `cross-account-android-installation-ownership-transfer`, `exhaustive-empty-loading-error-keyboard-navigation-matrix`, `full-arm64-integration`, `full-arm64-local-integration`, `historical13-created-credential-provenance`, `hub-checks-do-not-retest-product-media`, `installed-three-platform-update-ui-discovery-pending-final-publication`, `linux-arm64-local-execution`, `linux-dark-english-ui-in-root-review`, `long-duration-media`, `original-production13-database-migration`, `original-trusted_devices-semantic-preservation`, `physical-Android-device`, `physical-android-device`, `post-publication-update-discovery`, `production-server-not-upgraded`, `public-CA-production-TLS`, `public-production-ca-tls`, `screenshot-one-time-password-invalidation-before-publication`, `this-round-backup-restore`, `windows-arm64-wayland-media`, `windows-authenticated-pages-local-execution`。

发布后的四个公开 Release、Pages、latest 复验和三端 GUI 更新发现尚未包含于本记录，完成情况以独立发行记录为准。13.0.0 原始记录和历史下载继续保留，其验收结论不复用于 14.0.0。此次发行更新 GitHub、下载站和自动更新信息；正在运行的生产服务端保持原版本。
