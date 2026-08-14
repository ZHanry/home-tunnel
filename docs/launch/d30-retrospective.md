# D30 launch retrospective template

Do not publish this template with blanks, estimates, raw referrers, domains, IP addresses, credentials, private logs, or individual deployment details. Every number must have a dated GoatCounter, GitHub Traffic, Release, or deployment-feedback snapshot.

## Title

Home Tunnel 发布 30 天：访问、真实部署与下一步

## Evidence header

- Measurement window: `[D0 ISO-8601]` to `[D30 ISO-8601]`
- Pages snapshot: `[private archive reference]`
- GitHub Traffic snapshot: `[private archive reference]`
- Deployment-feedback review: `[date and reviewer]`
- Release/commit evaluated: `[tag and immutable commit]`

## Public summary

过去 30 天，我们用一组预先定义的指标验证 Home Tunnel 是否真的帮助个人和家庭服务完成自托管发布，而不是把 CI checkout 产生的克隆量当成增长。

| Metric | D0 | D7 | D14 | D30 | 30-day target |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pages unique visitors | `[value]` | `[value]` | `[value]` | `[value]` | 200 |
| Repository Stars | `[value]` | `[value]` | `[value]` | `[value]` | 20 |
| Valid non-maintainer deployments | `[value]` | `[value]` | `[value]` | `[value]` | 10 |
| Quick Start events | `[value]` | `[value]` | `[value]` | `[value]` | n/a |
| Release events | `[value]` | `[value]` | `[value]` | `[value]` | n/a |

有效部署只统计非维护者提交的真实平台、安装结果以及成功说明或阻碍。我们没有要求公开域名、IP、凭据或个人部署信息。

## Funnel

- Pages unique visitors: `[value]`
- Quick Start events: `[value]`
- Quick Start click-through: `[formula and value]`
- Release events: `[value]`
- Deployment-feedback events: `[value]`
- Valid deployment reports: `[value]`

只描述聚合来源，例如 `[channel: aggregate visits]`。不要公开可能识别个人的长尾 referrer。

## What worked

1. `[Evidence-backed observation]`
2. `[Evidence-backed observation]`
3. `[Evidence-backed observation]`

## Top blockers

| Blocker category | Aggregate count | Affected support tier | Planned response |
| --- | ---: | --- | --- |
| `[category]` | `[value]` | `[Linux Stable/macOS Beta/Windows Source]` | `[issue link or decision]` |

Do not quote a deployment report unless its author has explicitly approved the exact redacted text.

## Decisions

- If visitors were below target: `[entry-point/content decision]`.
- If Quick Start click-through was below 15%: `[hero/install-flow decision]`.
- If feedback completion was low: `[form/friction decision]`.
- Engineering priority for the next cycle: `[issue or milestone]`.

## Current limits

The public support matrix remains the source of truth. Do not imply that macOS Beta is Stable or that Windows has an official binary. Home Tunnel has no public dynamic demo. Production FRP remains 0.62.1 unless the documented atomic 0.70.1 promotion gates have subsequently passed.

Project: <https://zhanry.github.io/home-tunnel/?utm_source=d30_retrospective&utm_medium=post&utm_campaign=launch_2026_08>

Deployment feedback: <https://github.com/ZHanry/home-tunnel/issues/new?template=deployment_feedback.yml&utm_source=d30_retrospective&utm_medium=post&utm_campaign=launch_2026_08>
