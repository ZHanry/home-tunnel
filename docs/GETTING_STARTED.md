# 开始使用与联调

Home Tunnel 当前处于内部测试阶段。本指南帮助你从一个完整、可观察的测试环境开始。

## 准备什么

| 位置 | 准备事项 |
| --- | --- |
| 公网服务器 | Linux amd64 / arm64、Docker Engine、Docker Compose、公网地址 |
| DNS | 控制台域名与隧道通配符记录指向服务器 |
| 家中设备 | 可访问本地服务的 Windows / macOS / Linux 电脑或 NAS |
| 测试服务 | 一个简单的 HTTP 服务，例如本地 8080 端口的测试页面 |
| 手机（可选） | Android 8.0+ 设备，用于远程管理验证 |

## 1. 启动服务端

按[服务端 README](https://github.com/ZHanry/home-tunnel-server#readme)克隆并从源码启动。测试命令使用 `compose.yaml` 与 `compose.build.yaml`，无需依赖一个已经正式发布的产品镜像版本。

确认服务运行、控制台域名可通过 HTTPS 访问。读取一次性管理员密码，登录后改密，再创建测试账号。

## 2. 接入一台设备

按[客户端 README](https://github.com/ZHanry/home-tunnel-client#readme)构建包含 Agent 的完整安装包。首次测试选择一种模式：桌面 GUI 或 headless CLI。

- GUI：填写服务端 HTTPS 根地址，登录后注册设备。
- Linux / macOS 服务：安装完整包后，使用交互式 `home-tunnel-enroll` 完成注册。
- 单独编译一个 Go 入口不等于生成完整安装包；运行隧道还需要匹配的 Agent。

## 3. 验证一个 HTTP 连接

在 Web 控制台选择刚注册的设备，创建指向测试服务的 HTTP 连接。
先确认客户端主机能访问本地目标，再从其他网络访问分配的公网地址。
验证暂停、恢复、修改目标、客户端重启和短暂断网。

## 4. 验证手机管理

按 [Android README](https://github.com/ZHanry/home-tunnel-android#readme)构建调试 APK 并安装。
使用同一账号登录，查看已有设备，编辑测试连接并确认电脑端配置同步。

## 5. 再验证其他传输

TCP / UDP 由管理员明确分配公网端口，并配置对应的主机及云防火墙。
它们不经过 HTTP 网关，所以 HTTP Basic Auth、HTTP 限速和流量配额不作用于这条路径。
RTSP-over-TCP 可按普通 TCP 连接测试；UDP 测试须使用已知固定端口。

## 记录结果

记录各端提交 SHA、操作系统和架构、测试步骤、预期与实际行为。
反馈中使用示例域名、测试账号和脱敏日志。具体场景见[测试指南](TESTING.md)。
