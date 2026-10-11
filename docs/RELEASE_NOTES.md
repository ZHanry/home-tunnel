# NestLink 14.0.0

三端以当前桌面客户端为基准统一紫色品牌、图标、设备目录、账号与设置名称。Web 与 Android 保留适合浏览器和触控的导航，操作按设备能力呈现，远程控制与后台穿透独立管理。

Windows x64、Linux x64/ARM64 提供原生 GUI、远控、被控和穿透中枢；Web 提供账号管理、浏览器远控、信令与穿透服务；Android ARM64/x86_64 使用一个原证书签名的通用 APK。Android versionName 为 14.0.0，versionCode 为 14000000，应用 ID 和升级签名身份保留。FRP 独立依赖保持 0.70.1。

保留自建 HTTPS 账号登录、受保护凭据、自动续期、短期远控许可和撤销语义。基础 API v2 冻结契约保持不变，设备能力使用独立版本扩展。退出或撤销前台会话中止远控，独立后台凭据维持的服务遵循后台设备授权。

本版三个组件的真实 GitHub Release、原始文件 SHA-256、确切源提交及 Sigstore 签名已独立核验。稳定通道和下载清单绑定这些发行字节。各组件实际验收范围如下；13.0.0 原始记录和下载保留为历史记录。

- **server**: Exact signed299 server CI payload/immutable amd64 control/gateway/FRPS and installed feaf client in local Windows/WSL X11 task fixture; six real browser modes, native and three-phase four-protocol tunnel evidence. Historical server-only migration/API/Web retain their original scope and clock domains; no production deployment. PIN set extra trusted_devices flush remains failed/semantically unknown; OS root-password GUI unlock unverified.

- **client**: Exact feaf client CI products and installed Windows x64/Linux amd64; task X11 native/browser media with299 control/gateway and signed FRPS, local Android dcdf peer presence. Includes truthful original clock domains and failed attempts retained outside passed scenario selections.

- **android**: Exact signed universal14 APK on disposable API35 x86_64 AVD; actual original-certificate public13 to exact14 overwrite upgrade; observed account/UI/OS permission matrix; native media acceptance covers Android controller to Linux x64 same/cross sessions only. Android receiver media and cross-account installation ownership transfer remain unverified. Production server unchanged; private pixels/logs not published.

Android 真机、运营商网络/NAT、长期媒体以及其他未运行场景必须明确列为未验证。Windows 当前未配置 Authenticode 发布者证书，Sigstore 构建来源证据不能替代平台代码签名。生产部署升级独立于 GitHub 发行。

Physical Android devices, carrier networks and long-duration media were not run and remain unverified unless the final version-specific evidence explicitly records a real result. Version-specific reproducible acceptance passed within the component scopes above; outstanding coverage remains unverified.
