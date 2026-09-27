# 排查 / Troubleshooting

先分清是远控还是 FRP。两条路径的失败不应该互相掩盖。

## 远控失败

1. 确认两边都登录了同一台 9.0.0 服务器，并且被控端是已登录、未锁屏的 Windows 图形会话。
2. 确认授权还在：临时批准、固定密码或一次性临时密码。固定密码不是账号密码。
3. 等 UDP 直连。失败时记下界面上的直连错误。不要期待它改走 FRP、HTTP 或 TURN。
4. 被控端可以用本机快捷键断开。不需要的配对和授权应当撤销。

锁屏、登录前和 UAC 安全桌面在 9.0.0 里还不能控制。音频也不可用。这些限制不是配置错误。

## FRP 发布失败

在家庭客户端运行 `doctor`。它按层给出结果，诊断包不会自动上传。

| 层 | 看什么 |
| --- | --- |
| DNS | 域名是否指向你的服务器 |
| HTTPS | 证书和服务器地址是否就是客户端里填写的地址 |
| FRPS | 服务是否在跑，令牌是否匹配这一台服务器 |
| 授权 | 账号是否有权使用这条连接和端口池 |
| 本地目标 | 运行 Agent 的那台机器能否打开目标地址 |

手机上填写的 `127.0.0.1` 指的是手机自己，不是 NAS。TCP/UDP 没有 HTTP 登录保护。目标应用要自己做认证。

## 升级后

如果设备或连接不见了，先停止继续升级，按备份文档做恢复，而不是在生产数据上反复试验。
10.0.0 迁移还没有验收，开发构建不能当作这次恢复的替代品。

## 报告问题时

写明远控还是 FRP、四个组件里实际使用的版本、系统和复现步骤。去掉密码、令牌、接入码和私钥。安全问题走 [SECURITY.md](../SECURITY.md)。

## English

Decide whether the failure is remote control or FRP. Remote control fails closed when direct UDP is unavailable. FRP failures should name DNS, HTTPS, FRPS, authorization, or the local target. `doctor` does not upload its report. Do not treat a 10.0.0 development build as a fix for a 9.0.0 outage.
