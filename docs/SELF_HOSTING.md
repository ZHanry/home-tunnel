# 自建 HomeDesk 11 服务端

使用 [Server 候选发布](https://github.com/ZHanry/home-tunnel-server/releases/tag/v11.0.0-rc.2) 的部署 tar.gz，先核对 SHA256SUMS，再按包内 README 生成域名、TLS 与部署 secrets。部署镜像采用固定摘要；HTTP/HTTPS、FRPS 以及受控 TCP/UDP 端口池配置继续沿用原部署流程。

新增 hbbs 信令服务只开放 TCP 21115、TCP/UDP 21116。不启动 hbbr/TURN，不开放远控中继 21117 或旧 WebSocket 端口 21118/21119。部分 NAT、CGNAT、移动网或防火墙组合无法打洞，失败即停止。

1. 备份 SQLite、部署 secrets、客户端状态与已有 hbbs 身份。
2. 先运行 `docker compose up -d hbbs`，将公钥复制到宿主机：`docker cp "$(docker compose ps -q hbbs):/root/id_ed25519.pub" ./hbbs-public-key.txt`。镜像没有 shell/cat。只取公钥，不公开私钥。
3. 在 `.env` 设置 `HOME_TUNNEL_HBBS_SERVER=你的信令域名:21116` 与 `HOME_TUNNEL_HBBS_PUBLIC_KEY=上述Base64公钥`，再启动完整服务。
4. 改初始管理员密码、启用 MFA，按原规则分配穿透端口池与客户端权限。
5. Windows / Android 填写同一 hbbs 地址、公钥及家庭私网 CIDR，并配置 HTTPS 管理台。通用客户端不会连接内置的供应商服务器。

hbbs 身份在独立 `hbbs-data` 命名卷；原 SQLite/Restic 备份不包含它。Server 的 `deploy/scripts/hbbs-identity.py` 可通过宿主机 Docker/GPG 加密备份、验证并恢复到全新空卷，校验公私钥和归档路径且拒绝覆盖旧身份。完整命令见 [Server HomeDesk 部署说明](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/HOMEDESK.md)。管理台只需公钥，不挂载私钥。

升级不要继续叠加历史 `compose.rd.yaml` 或 `compose.turn.yaml`。设备目录需要 HTTPS 账号认证，同账号只能发现自己的有效设备；远控还必须获得被控端密码或批准。Web 按钮打开已安装的 HomeDesk，不在浏览器内传输屏幕。

长期穿透请使用 Client 合集中的独立 CLI/Agent，按对应平台 README 配置后台运行。桌面 GUI 中的受管 Agent 跟随窗口。关闭远控不应停止原本独立运行的隧道。
