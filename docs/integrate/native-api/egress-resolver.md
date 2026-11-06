---
title: Egress 与 Resolver
description: 用 EgressService 让部分 TCP 经调用方自带的 SOCKS5 出口离开，用 ResolverService 把 guest 的 DNS 查询转给调用方选定的上游：字段、校验、更新与宽限期、删除、判定顺序与故障观测。
---

# Egress 与 Resolver

本页说明两个 `v0.3.0` 新增的网络对象：Egress 是调用方运营的 SOCKS5 出口，Resolver 是调用方选定的 DNS 上游。Workspace 的网络策略引用它们之后，指定目的地的 TCP 连接从你的网络离开，guest 的 DNS 查询发往你选的服务器。读者是需要固定出口 IP、访问内网或自控 DNS 的集成开发者。网络策略本身的规则见[网络策略与 DNS](/integrate/native-api/network-policy)。

## 概述 {#overview}

| 对象 | 服务 | 被谁引用 | 能力名 |
|---|---|---|---|
| Egress <Badge type="tip" text="v0.3.0 新增" /> | `EgressService` | 策略的 `egresses`，以及 Resolver 的经 Egress 路径 | `workspace.network_policy.egress.socks5` |
| Resolver <Badge type="tip" text="v0.3.0 新增" /> | `ResolverService` | 策略的 `resolvers` | `workspace.network_policy.resolver` |

- 两者都只用于 `PUBLIC_INTERNET` 的策略，一个对象可以被多个 Workspace 引用。
- 写操作都带幂等键，规则见[幂等键](/integrate/native-api/conventions#idempotency)。
- 较旧的服务端会静默丢掉策略里的 `egresses` 与 `resolvers`，写入前先确认能力名存在。
- 部署中的 node 是否支持 Egress 与 Resolver 取决于部署配置，可向平台运营方确认。

## Egress {#egress}

### 字段 {#egress-fields}

| 字段 | 规则 |
|---|---|
| `spec.socks5` | 端点协议，目前只有 SOCKS5。创建与更新不选协议时返回 `invalid_argument` |
| `socks5.address` | `host:port`，host 是 IP 地址或主机名，端口 1 到 65535 |
| `socks5.username`、`socks5.password` | 可以都省略；给出时两个都要有，各 1 到 255 字节，按 RFC 1929 认证。口令只写：任何读取、列表与响应都不返回它，用户名照常返回 |
| `socks5.tls` | 给出即开启 TLS，SOCKS5 协商与转发的流量都在 TLS 内。`server_name` 省略时取端点的 host；`ca_cert` 是 PEM，至多 64 KiB，给出时代替系统信任库 |
| `spec.udp_enabled` | 缺省关闭。开启后，引用它的策略才能让 `udp` Resolver 的查询经它离开，见 [UDP](#udp-enabled) |
| `revision` | 服务端分配：创建时为 1，`spec` 变化时加一。与引用它的策略的 `revision` 互不影响 |
| `labels`、`annotations` | 规则与上限同 Workspace，用 `UpdateEgressLabels`、`UpdateEgressAnnotations` 修改，见 [labels 与 annotations](/integrate/native-api/workspaces#labels-annotations) |

### 端点校验 {#egress-endpoint-check}

创建与更新时，端点先核对一次：IP 地址落在私网、本机、组播、文档用途等固定的特殊用途网段，或主机名在 ctrl 解析一次的结果里有这样的地址，返回 `invalid_argument`。

这一步只是提早发现错误。node 每次拨号都会重新解析主机名，去掉不允许的地址，只连剩下的。

### 创建 {#create-egress}

`CreateEgress` 的字段是 `metadata.command_id`、`spec`、`labels` 与 `annotations`。下面的请求（JSON）创建一个开启 TLS 的 SOCKS5 出口：

```json
{
  "metadata": {"command_id": "egress-office-create"},
  "spec": {
    "socks5": {
      "address": "proxy.example.com:1080",
      "tls": {"server_name": "proxy.example.com"}
    }
  },
  "labels": {"team": "agents"}
}
```

端点要求认证时，在 `socks5` 里同时加上 `username` 与 `password`。口令在运行时从你的密钥管理系统读取后填入请求；代码、配置文件与日志里都不应出现它，记录请求时先去掉 `password`。

`GetEgress`、`ListEgresses`（支持 `label_selector` 与分页）读取 Egress，响应里没有口令。

### 更新 {#update-egress}

`UpdateEgress` 的字段：

| 字段 | 说明 |
|---|---|
| `metadata.command_id` | 幂等键 |
| `egress_id` | 目标 Egress |
| `expected_revision` | 必填，等于当前的 `revision`。不一致返回 `aborted`，`reason` 为 `CONFLICT`，内容不变 |
| `spec` | 完整的新内容，包括口令。口令读不回来，每次更新都要重新给出 |
| `drain_seconds` | 可选，0 到 3600，缺省 600。经旧 revision 建立的连接继续传输这么多秒后关闭，0 表示切换时立即关闭。它是这一次更新的参数，不随 Egress 保存 |

- 更新是整体替换，端点校验与创建相同。内容相同时成功且 `revision` 不变。
- 更新在保存后返回，不等待 Workspace。引用它的运行中 Workspace 随后把新连接切到新 revision，通常在 30 秒内完成。比较 Workspace 的 `network_policy_status.egresses` 里这一项的 `applied_revision` 与 `Egress.revision` 判断是否生效。
- node 一时取不到新凭证时保持原 revision，ctrl 会重试，Workspace 状态不变。
- 更早一次更新留下的、仍在宽限期内的连接保留它们自己的截止时间。
- 更新 Egress 不改变引用它的策略的 `revision`。

### 删除 {#delete-egress}

- 还有未删除的 Workspace 的策略引用它时，`DeleteEgress` 返回 `failed_precondition`，`reason` 为 `CONFLICT`。先用 `UpdateWorkspaceNetworkPolicy` 解除引用。
- 删除后，仍经它在宽限期内的连接立即关闭。
- 已删除的 Egress 对所有读取与引用都返回 `not_found`。

### UDP {#udp-enabled}

`udp_enabled` 让引用这个 Egress 的策略可以把 `udp` Resolver 的查询经它离开，SOCKS5 用 `UDP ASSOCIATE` 承载。

::: warning 注意
即使端点开启了 TLS，UDP 数据报也不受 TLS 保护，它们以明文发往端点答复的中继地址。
:::

仍有 `udp` Resolver 经它离开时，关闭 `udp_enabled` 的 `UpdateEgress` 返回 `failed_precondition`，`reason` 为 `CONFLICT`，内容不变。

### 在策略中引用 {#policy-egresses}

策略的 `egresses` 每一项写一个 Egress 与经它离开的目的网段：

| 字段 | 规则 |
|---|---|
| `egress_id` | 引用的 Egress，必须存在。不存在或已删除时返回 `not_found` |
| `destinations` | 1 到 256 项，写法与 `allow`、`deny` 相同，每项只作用于自己的地址族。可以写私网与平台网段 |

目的地落在网段里的新建 TCP 连接经这个 Egress 转发，其余照常直接离开。

- 一个策略至多引用一个 Egress。多于一项、`destinations` 为空或超过 256 项、条目写法不规范、`DENY_ALL` 带 `egresses`，都返回 `invalid_argument`，期望不变。
- **出口失败不回退为直接离开。** 端点连不上、TLS 校验失败、SOCKS5 协商或认证失败时，guest 的连接被重置。
- **只交给支持的 node。** 创建或启动时没有支持 Egress 的 node，返回 `failed_precondition`，`reason` 为 `CAPABILITY_UNAVAILABLE`，不会以不带 Egress 的策略运行；运行中加 Egress 而所在的 node 不支持时，返回同样的错误，期望不变。
- 只改 `destinations` 的顺序是内容变化，`revision` 加一，但不改变任何连接的走向。

### 判定顺序 {#egress-order}

策略引用了 Egress 时，一个连接按下面的顺序判定：

1. 发往链路 DNS 地址 53 端口的查询：交给链路 DNS 服务，不按目的地经 Egress 转发，见 [DNS](/integrate/native-api/network-policy#dns)。
2. 在 `deny` 里且不在 `allow` 里：拒绝。私网条目同样生效。
3. 目的地在 `destinations` 里的新建 TCP 连接：经 Egress 转发，不做私网与特殊用途地址的拒绝。
4. 目的地在 `destinations` 里的 ICMP echo（`ping`）：立即拒绝，回 ICMP 管理性禁止。
5. 其余：按直接离开的规则判定，见[判定顺序](/integrate/native-api/network-policy#destination-rules)。

### 宽限期 {#drain}

改变连接走向的策略修改不会立即切断已有连接：

- 改变走向指：原来直接离开、现在被 `destinations` 覆盖的连接，反过来的情况，以及经一个策略不再为它引用的 Egress 的连接。
- `UpdateWorkspaceNetworkPolicy` 的 `drain_seconds` 取 0 到 3600，缺省 600。走向变了的已有连接继续沿原路径传输这么多秒后关闭；0 表示新策略生效时立即关闭。宽限期内 `network_policy_status.draining_revision` 是旧的策略 revision。
- 新策略的 `mode`、`allow` 或 `deny` 不再放行的连接立即终止，不适用宽限期。
- 宽限期内再次修改，不延长更早修改的截止时间。

### 生效状态与观测 {#egress-observation}

Workspace 的 `network_policy_status.egresses` 是 node 上正在执行的策略引用的每个 Egress 一项：

| 字段 | 含义 |
|---|---|
| `egress_id` | 对应的 Egress |
| `applied_revision` | 新连接所用的 Egress revision。小于 `Egress.revision` 表示更新在这里还没生效 |
| `draining_revision` | 还有经更早 revision 建立、仍在宽限期内的连接时，给出其中最早的 revision；没有时为 0 |

Workspace 的 `egress_observations` 报告出口自身的故障，每个有故障的 Egress 一项，没有故障时为空：

| 字段 | 含义 |
|---|---|
| `egress_id` | 有故障的 Egress |
| `kind` | 故障类别，见下表 |
| `failing_since` | 这一轮连续故障开始的时间，取 node 的时钟 |
| `observed_at` | ctrl 记下这份报告的时间，取 ctrl 的时钟 |

| `kind` | 含义 |
|---|---|
| `EGRESS_OBSERVATION_KIND_ENDPOINT_UNREACHABLE` | 连不上端点，或端点主机名解析出的地址都被拨号检查去掉 |
| `EGRESS_OBSERVATION_KIND_TLS_VERIFICATION_FAILED` | 端点证书不受信任，或与 `server_name` 不符 |
| `EGRESS_OBSERVATION_KIND_HANDSHAKE_FAILED` | SOCKS5 协商失败、端点应答非法或超时 |
| `EGRESS_OBSERVATION_KIND_AUTHENTICATION_FAILED` | 端点明确拒绝了凭证 |
| `EGRESS_OBSERVATION_KIND_UDP_ASSOCIATION_FAILED` | 端点拒绝 UDP 关联、答复的中继地址被拒绝，或向中继发送时收到不可达 |

- **它是观测，不是状态。** 有故障时 Workspace 仍是 `AVAILABLE`，读取它不访问 node。故障持续时内容不变，下一次经 Egress 的连接成功后清除。
- **没有 `AUTHENTICATION_FAILED` 不说明凭证正确。** 端点对错误凭证不作应答时，观测是 `ENDPOINT_UNREACHABLE` 或 `HANDSHAKE_FAILED`。
- 代理报告目的地不可达或拒绝连接，是单次连接的结果，不产生观测。
- `kind` 以后会增加取值。遇到不认识的值时按出口故障处理，不要当作没有故障。
- 从故障出现到 ctrl 读得到，一般在 2 分钟以内。

## Resolver {#resolver}

### 协议与字段 {#resolver-spec}

`spec` 在四种协议中选一种，创建与更新不选协议时返回 `invalid_argument`：

| 协议 | 字段 | 规则 |
|---|---|---|
| `udp` | `udp.address` | IP 地址或 `IP:port`，端口缺省 53，不接受主机名。guest 经 TCP 发来的查询，经 TCP 发往同一地址 |
| `tcp` | `tcp.address` | IP 地址或 `IP:port`，端口缺省 53，不接受主机名 |
| `tls` | `tls.address` | DNS over TLS。`host` 或 `host:port`，host 是 IP 地址或主机名，端口缺省 853 |
| `https` | `https.url` | DNS over HTTPS，查询用 `POST` 发送。`https://host[:port]/path`，端口缺省 443，路径必须给出，至多 2048 字节；不接受用户信息、查询串与片段 |

其他字段：`revision`（创建时为 1，`spec` 变化时加一，与引用它的策略的 `revision` 互不影响），以及 `labels`、`annotations`（用 `UpdateResolverLabels`、`UpdateResolverAnnotations` 修改）。

### 规则 {#resolver-rules}

- IP 地址的写法同 `allow`、`deny` 的条目；IPv6 后面跟端口时写在方括号里，例如 `[2001:db8::53]:53`。读取原样返回写入的内容，缺省的端口不会被补上。
- `tls` 与 `https` 用系统信任库校验证书，校验的名字是 host。host 是 IP 地址时，证书要带这个 IP。
- **Resolver 没有凭证，读取返回全部内容。** `https.url` 的路径对同一部署里能读取 Resolver 的其他调用方可见，不要把访问令牌放在路径里。
- **更新是整体替换。** `UpdateResolver` 必须带 `expected_revision`，不一致返回 `aborted`，`reason` 为 `CONFLICT`，内容不变。内容相同时成功且 `revision` 不变。
- **更新在保存后返回，不等待 Workspace。** 引用它的运行中 Workspace 随后把新查询发往新 revision，通常在 30 秒内完成；已经发出的查询按原配置完成。比较 `network_policy_status.resolvers` 里对应项的 `applied_revision` 与 `Resolver.revision` 判断是否生效。
- **被引用的 Resolver 不能删除。** 还有未删除的 Workspace 的策略引用它时，`DeleteResolver` 返回 `failed_precondition`，`reason` 为 `CONFLICT`。已删除的 Resolver 对所有读取与引用都返回 `not_found`。

### 在策略中引用与路径 {#resolver-path}

策略的 `resolvers` 至多一项，每项写一个 Resolver 与查询离开的路径：

| 字段 | 规则 |
|---|---|
| `resolver_id` | 引用的 Resolver，必须存在。不存在或已删除时返回 `not_found` |
| `path.direct` | 从 node 的上联地址直接发往上游。值是一个空对象 `{}` |
| `path.egress_id` | 经这个 Egress 发往上游。它必须列在同一策略的 `egresses` 里，与那一项的 `destinations` 是否覆盖上游无关；上游可以在调用方的内网。`udp` Resolver 还要求这个 Egress 开启 `udp_enabled` |

- **直接路径的上游在引用时先核对一次。** IP 地址落在私网、本机、组播、文档用途等固定的特殊用途网段，或主机名在 ctrl 解析一次的结果里有这样的地址，返回 `invalid_argument`；被直接路径引用的 Resolver 更新成这样的上游，同样返回 `invalid_argument`。这只是提早发现错误：node 拨号时用部署的 DNS 服务器解析主机名，去掉不允许的地址，只连剩下的，全部被去掉时这次查询得到 `SERVFAIL`。
- **经 Egress 时 node 不解析也不核对上游。** 主机名交给端点解析；`udp` 上游经 `UDP ASSOCIATE`，其余经 `CONNECT`。端点答复的 UDP 中继地址按端点的规则核对。Egress 更新后，经它的查询与 TCP 连接一起换用新 revision；`drain_seconds` 只作用于 TCP 连接。
- **非法组合返回 `invalid_argument`，期望不变**：`DENY_ALL` 带 `resolvers`、多于一项、没有 `path`、`path.egress_id` 不在策略的 `egresses` 里、`udp` Resolver 经没有开启 `udp_enabled` 的 Egress、直接路径的上游落在特殊用途网段。
- **只交给支持的 node。** 创建或启动时没有支持 Resolver 的 node，返回 `failed_precondition`，`reason` 为 `CAPABILITY_UNAVAILABLE`，不会以不带 Resolver 的策略运行；运行中加 Resolver 而所在的 node 不支持时，返回同样的错误，期望不变。
- 引用、更换或解除 Resolver 都是内容变化，策略的 `revision` 加一；RPC 在新配置生效后返回，之后的新查询按新配置发出。guest 的 `/etc/resolv.conf` 不变。
- `v0.3.0` 之前启动、一直没有重启的 Workspace 不能引用 Resolver，见 [DNS](/integrate/native-api/network-policy#dns)。

### 行为与上限 {#resolver-behavior}

- **上游不可用时回 `SERVFAIL`，不回退部署的 DNS 服务器。**
- 一次查询从收到到应答至多 4 秒，时限内没有应答时回 `SERVFAIL`；`udp` 上游 2 秒没有应答时重发一次。
- 每个 Workspace 同时处理的查询至多 256 个，超出的立即回 `SERVFAIL`。
- guest 经 UDP 收不下的应答被截断：上限取查询里 EDNS 声明的大小，没有 EDNS 时为 512 字节；超出时回带 TC 位的应答，guest 改用 TCP 重查。
- 引用 Resolver 的 Workspace 里，guest 经 TCP 发往链路 DNS 地址的连接同时至多 64 条，超出的立即关闭；10 秒没有查询的连接被关闭。

### 生效状态与观测 {#resolver-observation}

`network_policy_status.resolvers` 是 node 上正在执行的策略的 `resolvers` 每项一项，用 `resolver_id` 加 `path` 对应：

| 字段 | 含义 |
|---|---|
| `resolver_id`、`path` | 对应的列表项 |
| `applied_revision` | 新查询所用的 Resolver revision。小于 `Resolver.revision` 表示更新在这里还没生效 |

Workspace 的 `resolver_observations` 报告上游这一段的故障，每个有故障的列表项一项，没有故障时为空：

| 字段 | 含义 |
|---|---|
| `resolver_id`、`path` | 有故障的列表项 |
| `kind` | `RESOLVER_OBSERVATION_KIND_UPSTREAM_UNREACHABLE`：连不上上游，或直接路径时上游地址都被拒绝；`RESOLVER_OBSERVATION_KIND_UPSTREAM_TIMEOUT`：时限内没有应答；`RESOLVER_OBSERVATION_KIND_TLS_VERIFICATION_FAILED`：`tls` 或 `https` 上游的证书不受信任或与 host 不符；`RESOLVER_OBSERVATION_KIND_HTTP_ERROR_STATUS`：`https` 上游返回非 2xx |
| `failing_since` | 这一轮连续故障开始的时间，取 node 的时钟 |
| `observed_at` | ctrl 记下这份报告的时间，取 ctrl 的时钟 |

- 上游正常回答的 `NXDOMAIN`、`SERVFAIL` 是 DNS 的结果，不产生观测。
- 经 Egress 时，Egress 自身的故障记在 `egress_observations`，这里不重复。
- 其余规则同 Egress 的观测：不改变 Workspace 状态，读取不访问 node，故障持续时内容不变，下一次查询成功后清除；`kind` 以后会增加取值，遇到不认识的值时按上游故障处理。

## 相关文档 {#related}

- [网络策略与 DNS](/integrate/native-api/network-policy)：mode、`allow` 与 `deny`、链路 DNS。
- [运行状况观测](/integrate/native-api/observability)：Workspace 上的各类观测字段。
- [网络、Egress 与 Resolver](/integrate/kibo/network)：用 `kibo` 管理 Egress 与 Resolver。
- [出网策略与出站代理](/integrate/e2b/network#egress-proxy)：E2B SDK 的 `egressProxy`。
