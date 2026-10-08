# 四仓职责

| 仓库 | 维护内容 |
| --- | --- |
| [home-tunnel](https://github.com/ZHanry/home-tunnel) | 通道来源 distribution.json、下载/文档/网站、整合发行包 |
| [home-tunnel-server](https://github.com/ZHanry/home-tunnel-server) | 暖居 Web、Node/SQLite、API 1.6.0、设备目录、hbbs 信令、完整穿透控制与部署 |
| [home-tunnel-client](https://github.com/ZHanry/home-tunnel-client) | Rust/Flutter 原生核心、桌面/共用移动 UI、严格 P2P 策略、Windows 包与原 Go CLI/Agent |
| [home-tunnel-android](https://github.com/ZHanry/home-tunnel-android) | 固定 Client 子模块、Android SDK/ABI/Keystore/模拟器门禁与原证书签名通用 APK |

Hearth Web 来源为 ymhaha/home-tunnel 的 codex/hearth-web-ui（00d4719dfb33d4bef6b7fb290220d80d637ca6ef）；Client 来源为 codex/hearth-client-ui（6ba2383023d2851b394f13689054c31f4f8c39af）。Client 保留两个父分支历史，Android 不复制修改核心。最终每个附件的源码 revision 在材料 BUILD.json 中记录，下载清单只收录实际发布后核对的字节。
