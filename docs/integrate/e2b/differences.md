---
title: 与 E2B 的差异
description: Kibotos E2B 兼容网关明确未提供的能力、与上游 E2B 的行为差异汇总，以及各接口 HTTP 状态码与 envd 错误码的含义和处理建议。
---

# 与 E2B 的差异

本页汇总 Kibotos 的 E2B 兼容网关与上游 E2B 的不同之处：哪些能力明确没有提供、哪些行为不同，以及各接口返回的状态码与处理建议。读者是把已有 E2B 代码迁移到 Kibotos 的开发者，以及评估兼容程度的架构师。每一条只写结论，细节见链接的页面。

兼容目标与验收基线见[兼容版本](/integrate/e2b/overview)。

## 明确未提供的能力 {#unsupported}

网关做不到的能力分四类：有路由但返回 501 的接口、创建或修改网络时被拒绝的字段、envd 协议里未实现的方法，以及没有路由的接口。前三类都会明确失败，不会悄悄忽略请求。

### 返回 501 的路由 {#unsupported-routes}

以下路由存在，统一返回 HTTP 501：

| 请求 | SDK 用法 | 能力名 | 缺少的原生能力 |
|---|---|---|---|
| `POST /sandboxes/{id}/fork` | `sandbox.fork()` | `sandbox fork` | 快照捕获与从快照创建副本 |
| `POST /sandboxes/{id}/snapshots` | `sandbox.createSnapshot()` | `snapshot capture` | 快照资源与捕获命令 |
| `GET /snapshots` | `Sandbox.listSnapshots()` | `snapshot listing` | 同上 |
| `DELETE /templates/{ref}` | `Sandbox.deleteSnapshot()` | `snapshot deletion` | 同上 |
| `GET /teams/{teamID}/metrics`、`GET /teams/{teamID}/metrics/max` | 无 | `team metrics` | 团队：API key 由整个部署共用，没有可统计的团队 |
| `GET /sandboxes/{id}/metrics`、`GET /sandboxes/metrics`，仅在部署没有接入实例指标存储时 | `getMetrics()` | `metrics` | 实例指标存储，取决于部署配置 |

- 响应体为 `{"code":501,"message":"unimplemented: <能力名> is not supported by the core gateway"}`。官方 SDK 抛出 `SandboxError`，消息为 `501: unimplemented: <能力名> is not supported by the core gateway`。
- 这些请求在通过 API key 认证后立即返回，不调用原生 API，不修改任何资源。sandbox ID 不存在时同样返回 501。
- 返回 501 而不是 404，是因为官方 SDK 把 404 理解为 sandbox 不存在。

### 创建与修改网络时拒绝的字段 {#unsupported-fields}

| 字段 | 出现在 | 结果 |
|---|---|---|
| `envVars`（SDK 的 `envs`）非空 | 创建 | 501 `sandbox environment variables` |
| `iam` 非空 | 创建 | 501 `IAM tokens` |
| `mcp` 非空 | 创建 | 501 `MCP configuration` |
| `autoResume: {"enabled": true}`（SDK 的 `lifecycle.autoResume: true`） | 创建 | 501 `autoResume` |
| 非空的 `snapshotID` | 创建 | 501 `snapshot restore` |
| `network.allowOut` 含域名或域名模式 | 创建与修改网络 | 501 `network egress allowlist domains`；`denyOut` 不含 `ALL_TRAFFIC` 时先返回 400，与 E2B 相同 |
| `network.rules` 非空 | 创建与修改网络 | 501 `network egress rules` |
| `egressProxy` 只有 `username` 没有 `password` | 创建与修改网络 | 501 `network egress proxy username without a password` |
| 带 `allowOut` 或 `denyOut` 条目，而部署不支持按地址的出站规则 | 创建与修改网络 | 501 `network egress allow and deny lists` |
| 带 `egressProxy`，而部署不支持出站代理 | 创建与修改网络 | 501 `network egress proxy` |

- 创建时的 501 消息前多一个 `create sandbox: ` 前缀，修改网络时多一个 `update sandbox network: ` 前缀。
- 字段缺省、为 `null`、空对象或空数组都视为没有设置。
- 检查在写入任何状态之前完成，被拒绝的请求不会留下资源。字段的完整规则见 [sandbox 生命周期](/integrate/e2b/sandboxes)与[出网策略与出站代理](/integrate/e2b/network)。

### envd 协议中未实现的方法 {#unsupported-envd}

| 方法或用法 | 结果 | 替代做法 |
|---|---|---|
| `/process.Process/List`（SDK 的 `commands.list()`） | `unimplemented` | 自己保存后台进程的 PID |
| `/process.Process/StreamInput` | `unimplemented` | 用 `SendInput` |
| 按 `tag` 选择进程 | `invalid_argument` | 按 PID 选择 |
| `SIGTERM`、`SIGKILL` 以外的信号 | `invalid_argument` | 在命令里用 `kill` 发送 |
| `/filesystem.Filesystem/CreateWatcher`、`GetWatcherEvents`、`RemoveWatcher` | `unimplemented`：它们要求网关跨请求保存监视状态，而网关不保存状态 | 用 `WatchDir`（SDK 的 `files.watchDir()`） |
| `WatchDir` 的 `recursive: true` | `unimplemented` | 分别监视需要的各层目录 |

### 没有路由的接口 {#unrouted}

本站没有列出的 E2B 控制 API 路由（例如 E2B 的 Template 构建与管理接口）没有路由，返回 404。官方 SDK 可能把这个 404 报告为 `SandboxNotFoundError`，看起来像 sandbox 不存在。

- Template 由 Kibotos 管理，见 [Template 与 Platform](/templates/overview)。
- 支持的接口清单见[支持的接口](/integrate/e2b/overview)。

## 行为差异 {#behavior}

| 方面 | Kibotos 的行为 | 详见 |
|---|---|---|
| 暂停与恢复 | 接受 `memory:true`，但统一按冷暂停处理：内存、进程与连接不保留，根文件系统的修改尽力保留，只有 Volume 里的数据承诺保留。不提供内存快照、快照恢复与克隆 | [暂停与恢复](/integrate/e2b/pause-resume) |
| 暂停中的到期时间 | 暂停清除到期时间，暂停中的 sandbox 一直保留到被删除，期间仍占用存储容量 | [暂停与恢复](/integrate/e2b/pause-resume) |
| 自动恢复 | 收到请求时自动恢复（`autoResume`）不支持，需要显式 `connect` | [暂停与恢复](/integrate/e2b/pause-resume) |
| 容量不足 | 创建 sandbox、`connect` 与创建 Volume 返回 503。恢复失败的 sandbox 仍是暂停，容量恢复后可以再次 `connect` | [容量不足时的恢复](/integrate/e2b/pause-resume#capacity) |
| 失败的 sandbox | E2B 没有失败状态。Kibotos 中意外结束的 sandbox 查询与暂停返回 502，`connect` 返回 409，列表不列出；可以删除，或联系平台运营方处理后再 `connect` | [暂停与恢复](/integrate/e2b/pause-resume) |
| 资源 | 创建请求不带资源字段，按部署默认值分配，默认 1 核、1 GiB 内存、5 GiB 根文件系统可写空间。`diskSizeMB` 在 node 确认前为 `0` | [sandbox 生命周期](/integrate/e2b/sandboxes) |
| Template | Template ID 就是 Kibotos 的 Template ID，没有别名，列表的 `template` 筛选按它精确匹配 | [Template 与 Platform](/templates/overview) |
| 团队与 API key | API key 由整个部署共用，没有团队，同一部署的所有 key 看到同一批 sandbox | [概述与兼容范围](/integrate/e2b/overview) |
| metadata | 与网关保存的其他信息一起受 labels 合计 65536 字节、annotations 合计 262144 字节的上限约束，超出时创建返回 400 | [sandbox 生命周期](/integrate/e2b/sandboxes) |
| 环境变量 | 创建时为整个 sandbox 设置的 `envs` 不支持，单条命令的 `envs` 可用 | [命令、终端与文件](/integrate/e2b/commands-files) |
| `secure` | 不改变认证，envd 请求总是需要 envd access token | [概述与兼容范围](/integrate/e2b/overview) |
| Volume | 每个 sandbox 至多一个 Volume。没有挂载独立 Volume 时自带一个挂在 `/data` 的 Volume，随 sandbox 删除 | [Volume](/integrate/e2b/volumes) |
| 出网与 IPv6 | 拒绝全部 IPv4 时同时拒绝 IPv6，与只有 IPv4 出网的 E2B 效果一致。`denyOut` 不接受 `::/0` | [出网策略与出站代理](/integrate/e2b/network) |
| DNS | 带 `allowOut` 或 `denyOut` 时 DNS 查询照常可用，E2B 上这时 DNS 也被拒绝。全部拒绝时 DNS 查询立即失败 | [出网策略与出站代理](/integrate/e2b/network) |
| 出站代理 | 到代理的连接不使用 TLS；只给用户名不给口令返回 501 | [出站代理](/integrate/e2b/network#egress-proxy) |
| envd 请求消息 | 每条请求消息最多 4 MiB，E2B 不设这个上限。单次发送超过约 3 MiB 的 stdin 要分几次 | [命令、终端与文件](/integrate/e2b/commands-files) |
| 进程 | 只能按 PID 选择进程，不能列出进程，信号只支持 `SIGTERM` 与 `SIGKILL` | [命令、终端与文件](/integrate/e2b/commands-files) |
| 目录监视 | 只支持非递归的 `watchDir` | [命令、终端与文件](/integrate/e2b/commands-files) |
| 应用端口的空闲期限 | 两个方向都没有字节达到 15 分钟时断开，升级后的 WebSocket 也一样；E2B 对升级后的连接不设期限 | [应用端口与桌面](/integrate/e2b/ports) |
| 应用端口的目标 | 只转发到 sandbox 内 IPv4 回环地址上的端口 | [应用端口与桌面](/integrate/e2b/ports) |
| 指标 | 最新约 30 秒的样本延后返回，批量接口只返回 30 秒窗口内有样本的 sandbox，首尾两个桶是完整的桶；部署没有接入指标存储时返回 501 | [sandbox 指标](/integrate/e2b/metrics) |
| 兼容字段 | `clientID` 总是空字符串，`envdVersion` 报告 `0.6.4` | [sandbox 生命周期](/integrate/e2b/sandboxes) |

## HTTP 状态码 {#status-codes}

### 控制 API {#control-api-status}

成功时的状态码：

| 接口 | 成功 |
|---|---|
| `POST /sandboxes` | 201 |
| `GET /sandboxes/{id}`、`GET /v2/sandboxes` | 200 |
| `DELETE /sandboxes/{id}` | 204 |
| `POST /sandboxes/{id}/pause` | 204 |
| `POST /sandboxes/{id}/connect` | 200：sandbox 原本在运行；201：sandbox 被恢复 |
| `POST /sandboxes/{id}/timeout`、`POST /sandboxes/{id}/refreshes` | 204 |
| `PUT /sandboxes/{id}/network` | 204 |
| `POST /volumes` | 201 |
| `GET /volumes`、`GET /volumes/{id}` | 200 |
| `DELETE /volumes/{id}` | 204 |
| `GET /sandboxes/{id}/metrics`、`GET /sandboxes/metrics` | 200 |

失败时的响应体是 `{"code": <状态码>, "message": "..."}`。各状态码的含义与处理：

| 状态码 | 含义 | 常见情形 | 调用方处理 |
|---|---|---|---|
| 400 | 请求不合法 | 请求体不是合法 JSON 或缺少 `templateID`；`timeout` 超过部署的上限（创建与 `connect`）；`Idempotency-Key` 超过 256 字节；出网条目写法错误或超过 256 项；`maskRequestHost` 不合法；`volumeMounts` 多于一项或路径不规范；metadata 超过上限；Volume 名称不合法；列表参数或 `nextToken` 不合法；指标参数不合法 | 修正请求，不要原样重试 |
| 401 | 认证失败 | `X-API-Key` 缺失或不被接受，消息为 `invalid API key` | 检查 API key |
| 404 | 不存在 | sandbox 或 Volume 不存在、已删除、属于其他部署或 ID 格式不合法；Template 不存在；`volumeMounts` 指向的 Volume 不存在；没有路由的接口 | 确认 ID 与部署。sandbox 已删除时停止使用它 |
| 409 | 状态冲突 | 已暂停时再次暂停；sandbox 正在启动或停止；`timeout`、`refreshes` 或修改网络时 sandbox 不在运行；`connect` 一个失败的 sandbox；同一个 `Idempotency-Key` 换了请求内容；并发修改；Volume 正在删除、失败或已丢失；删除仍挂在 sandbox 上的 Volume；挂载已被其他 sandbox 挂载的 Volume | 读取当前状态后再决定下一步，不要盲目重试 |
| 500 | 网关无法给出完整的结果 | 修改网络 30 秒内没能确认生效，修改可能已被接受；查询 sandbox 时挂载的 Volume 或出站代理的状态无法回显；指标存储不可用 | 修改网络：读取当前配置后再决定。查询：检查挂载的 Volume，不要当作 sandbox 已删除。指标：稍后重试 |
| 501 | 能力未提供 | 见[明确未提供的能力](#unsupported) | 不要重试，去掉对应的选项或改用其他做法 |
| 502 | sandbox 已失败，或上游调用失败 | 查询或暂停一个失败的 sandbox，消息以 `sandbox failed:` 开头；创建或恢复超过约 90 秒没有完成；暂停时停止超过约 1 分钟；其他原生调用失败 | 消息以 `sandbox failed:` 开头时不可重试，删除 sandbox 或联系平台运营方；其他情况带同一个 `Idempotency-Key` 重试，并按 metadata 核对是否已经生效 |
| 503 | 容量暂时不足 | 创建 sandbox、`connect` 或创建 Volume 时没有容量，消息含 `resource_exhausted` | 退避后重试。创建失败时按 metadata 清理可能留下的暂停中 sandbox |

### envd 协议 {#envd-status}

进程与文件系统方法用 Connect 错误码报告失败。一元方法的 HTTP 状态按 Connect 规范对应错误码；流式方法（`Start`、`Connect`、`WatchDir`）的错误在流的结束消息里，HTTP 状态为 200。

| 错误码 | 一元方法的 HTTP 状态 | 常见情形 | 调用方处理 |
|---|---|---|---|
| `unauthenticated` | 401 | `X-Access-Token` 缺失或错误；sandbox 重新启动过或 token 被撤销，消息提示重新 `connect` | 调用 `Sandbox.connect()` 取得当前的 token 后重试 |
| `permission_denied` | 403 | 写入只读目录 | 不可重试 |
| `not_found` | 404 | 路径不存在；工作目录不存在；监视的目录被删除或移走 | 检查路径 |
| `invalid_argument` | 400 | 账号名没有在 Template 中声明；按 `tag` 选择进程；不支持的信号；请求格式不合法 | 修正请求 |
| `failed_precondition` | 400 | Template 声明的默认账号在 guest 中不可用 | 以 `root` 恢复账号后暂停再恢复 sandbox |
| `resource_exhausted` | 429 | 请求消息超过 4 MiB；guest 内的进程或资源用尽；空间或配额用尽；目录监视的事件来不及送达 | 拆分请求或释放资源。空间用尽不可重试 |
| `unimplemented` | 501 | 未实现的方法，递归监视 | 不要重试 |
| `unavailable` | 503 | sandbox 没有在运行，例如已暂停；guest 正在重启 | 确认 sandbox 状态，需要时 `connect` 后重试 |
| `data_loss` | 只出现在流里 | 进程流断开太久，输出有缺口 | 用 `commands.connect(pid)` 重新连接 |

文件内容接口与健康检查直接用 HTTP 状态码：

| 接口 | 状态码 |
|---|---|
| `GET /files` | 200 或 206（`Range`）；400 参数不合法；401 token 错误；403 无权读取；404 不存在；409 默认账号不可用；416 `Range` 无法满足 |
| `POST /files` | 200；400 请求不合法；401 token 错误；403 目录只读；404 路径不存在；409 默认账号不可用；413 空间或配额用尽 |
| `GET /health` | 204 正在运行；502 不存在或没有在运行；503 暂时无法判断；400 请求里没有可识别的 sandbox |

### 应用端口 {#port-status}

| 状态码 | 含义 | 调用方处理 |
|---|---|---|
| 401 | traffic token 缺失、错误或重复；sandbox 重新启动过或 token 被撤销 | 确认 token，调用 `Sandbox.connect()` 取得当前的 token |
| 404 | sandbox 不存在、属于其他部署、ID 格式不合法，或端口超出范围 | 确认地址 |
| 502 | 连不上 sandbox 内的端口（例如没有程序在监听），或网关暂时拿不到连接 node 的凭证 | 稍后重试，确认服务已经监听 IPv4 回环地址 |
| 503 | sandbox 没有在运行（例如已暂停），或 Kibotos 暂时不可用 | 确认 sandbox 状态，需要时先 `connect` |

完整说明见[应用端口与桌面](/integrate/e2b/ports)。全站错误码的集中参考见[错误码](/reference/errors#e2b)。

### 重试建议 {#retry-guidance}

- 带 `Idempotency-Key` 发送创建、`connect`、暂停、`timeout`、`refreshes`、修改网络与删除，结果不明时用同一个 key 重试，见[幂等](/integrate/e2b/sandboxes)。
- 502 与 503 按指数退避重试，并设置重试上限。
- 400 与 501 不要原样重试，它们不会自己变好。
- 409 先读取当前状态，再决定是否发起新的请求。
- envd 或应用端口返回 401 时，先 `connect` 再重试。

## 相关文档 {#related}

- [概述与兼容范围](/integrate/e2b/overview)
- [暂停与恢复](/integrate/e2b/pause-resume)
- [错误码](/reference/errors)
- [常见问题排查](/integrate/troubleshooting)
