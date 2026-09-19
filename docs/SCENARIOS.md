# 家庭服务场景 / Application recipes

下表是连接表单的示例，不会安装或修改第三方应用。必须先在客户端所在电脑/NAS
验证本地地址；如应用运行在 Docker 中，使用发布到宿主机的端口或可达的网络地址。
建议用普通用户创建。子域最终受部署的前缀规则影响。

| 应用 | 类型 | 本地目标示例 | 子域建议 | 应用端准备 |
| --- | --- | --- | --- | --- |
| Home Assistant | HTTP | `http://127.0.0.1:8123` | `ha` | 启用应用 MFA，设置正确的外部 URL；按 HA 官方指南只信任实际代理来源 |
| Immich | HTTP | `http://127.0.0.1:2283` | `photos` | 保留登录认证，使用支持的 Immich 版本；核查上传大小和超时 |
| Jellyfin | HTTP | `http://127.0.0.1:8096` | `media` | 设置外部地址、强密码，测试 WebSocket、Range 请求和移动端播放 |
| SSH | SSH / TCP | `127.0.0.1:22` | 不适用 | SSH 密钥认证；管理员开放 TCP 池并授权，端口自动分配 |
| RTSP 摄像头 | RTSP / TCP | `192.168.1.20:554` | 不适用 | 摄像头账号认证；播放器使用 RTSP over TCP，补上具体流路径 |

`127.0.0.1` 指实际运行客户端/Agent 的主机；不能在手机端填写手机地址来指代 NAS。
首次测试用外部网络验证，避免只测到路由器的内网回环。较大媒体流量可能消耗公网
服务器带宽和额度，HTTP 流量限制不等价于限制任意原始 TCP/UDP 媒体连接。

Home Assistant 的 `trusted_proxies` 不能写成任意公网来源；只添加经过确认的实际
反向代理网络。移动应用/WebSocket/流媒体可能无法使用额外的 HTTP Basic Auth，
这时依赖应用自身的登录和 MFA，按需使用 IP 白名单。配置访问策略后验证实际客户端。

NAS 安装方式见 [NAS 模板](https://github.com/ZHanry/home-tunnel-client/tree/main/packaging/nas)
和 [部署预检](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/NAS.md)。
目标应用的数据备份是单独的任务，Home Tunnel 的数据库备份不包含照片或媒体文件。

English: these are connection recipes, not third-party application installers.
Verify the target from the Agent host first. Use application authentication/MFA,
trust only actual reverse-proxy addresses, and test WebSocket/Range/upload behavior
with the application's real clients. Raw transports provide no HTTP access policy.
Public bandwidth and each application's data backup remain your responsibility.
