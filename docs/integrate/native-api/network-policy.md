---
title: 网络策略与 DNS
description: Workspace 的出站网络策略：DENY_ALL 与 PUBLIC_INTERNET 两种 mode、allow 与 deny 的判定顺序和写法、条目上限、修改与生效状态、能力名与 node 支持，以及 guest 的 DNS 去向。
---

# 网络策略与 DNS

本页说明 Workspace 能访问哪些外部地址，以及 guest 的 DNS 查询发往哪里。网络策略在创建 Workspace 时给出，之后用 `UpdateWorkspaceNetworkPolicy` 整体替换。读者是需要控制 Agent 出网范围的集成开发者与安全评审人员。

## 概述 {#overview}

- `spec.network_policy` 是期望的策略（`NetworkPolicy`），由调用方写入。
- `network_policy_status` 是 node 报告的实际生效情况。判断策略是否生效看它，不看 RPC 是否成功。
- 策略只管 guest 发起的出站流量。让部分流量经调用方自己的出口离开、或把 DNS 查询转给自选的上游，分别用 Egress 与 Resolver，见 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。

## 字段 {#fields}

| 字段 | 含义 |
|---|---|
| `mode` | `NETWORK_POLICY_MODE_DENY_ALL` 或 `NETWORK_POLICY_MODE_PUBLIC_INTERNET`。省略或为 `UNSPECIFIED` 时是 `DENY_ALL` |
| `allow`、`deny` | 只用于 `PUBLIC_INTERNET`，按目的地址收窄公网出站。每项是一个地址或一个 CIDR |
| `egresses` | 只用于 `PUBLIC_INTERNET`，让部分目的地的 TCP 经调用方的 Egress 离开 |
| `resolvers` | 只用于 `PUBLIC_INTERNET`，把 guest 的 DNS 查询转给调用方选定的上游 |
| `revision` | 服务端分配：创建时为 1，`mode`、`allow`、`deny`、`egresses`、`resolvers` 任一变化时加一。请求里的值被忽略 |

## 两种 mode {#modes}

| mode | 效果 |
|---|---|
| `DENY_ALL` | 不允许任何出站。DNS 查询在 Workspace 内立即失败，没有报文离开 Workspace |
| `PUBLIC_INTERNET` | 允许 guest 主动发起的 TCP 连接与 ICMP echo（`ping`）到达公网目的地，IPv4 与 IPv6 都可以，回包随之放行。其他协议不放行；DNS 只发往 guest 链路上的一个地址，见 [DNS](#dns) |

- `DENY_ALL` 是缺省值，部署配置不会改变它。
- 两种 mode 下，直接离开的流量一律不能到达私有地址、本机地址与平台使用的特殊用途地址，`allow` 也放不开。经 Egress 转发的连接从调用方的网络离开，不受这条限制。
- `PUBLIC_INTERNET` 下，不以 SYN 开头的新 TCP 流会被重置。例如连接跟踪条目因宽限期结束被删除之后，guest 在原连接上继续发送会收到 RST。

## 判定顺序 {#destination-rules}

`PUBLIC_INTERNET` 的策略按目的地址判定一个直接离开的连接：

1. 私有地址与特殊用途地址：拒绝。`allow` 也放不开。
2. 在 `allow` 里：放行。同时被 `deny` 覆盖也放行。
3. 在 `deny` 里：拒绝。连接立即失败，不是超时。
4. 其余：放行。

例如 `deny: ["0.0.0.0/0", "::/0"]` 加 `allow: ["203.0.113.0/24"]`，表示只允许访问 `203.0.113.0/24` 这一段 IPv4 地址，IPv6 全部拒绝。

策略引用了 Egress 时，`deny` 同样作用于经 Egress 的连接，完整顺序见 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。

### 地址族 {#address-family}

每个条目只作用于自己的地址族。`0.0.0.0/0` 不影响 IPv6；要同时收窄两个地址族，再写一条 `::/0`。

### 写法 {#canonical-form}

条目必须是规范写法，服务端不会改写后接受：

- CIDR 的主机位必须为零：写 `10.0.0.0/8`，`10.0.0.1/8` 返回 `invalid_argument`。
- IPv4 不带前导零；IPv6 用小写压缩形式，例如 `2001:db8::/32`；不带 zone。
- 单个地址可以不写前缀长度，等于这个地址的单地址前缀。
- 写在私有或特殊用途网段里的条目是合法的，但它们只对经 Egress 转发的连接起作用。

### 上限 {#entry-limits}

- `allow` 与 `deny` 两个列表合计最多 256 项，超出返回 `invalid_argument`。
- `DENY_ALL` 带任何一项 `allow`、`deny`、`egresses` 或 `resolvers`，都返回 `invalid_argument`。
- 服务端按给出的顺序保存条目。顺序与重复不影响效果，但只改顺序也算内容变化，`revision` 加一。

## 修改与生效 {#update}

`UpdateWorkspaceNetworkPolicy` 用一个完整的策略替换当前的期望：

| 字段 | 说明 |
|---|---|
| `metadata.command_id` | 幂等键 |
| `workspace_id` | 目标 Workspace |
| `network_policy` | 完整的新策略，不是增量。`revision` 被忽略 |
| `expected_revision` | 可选。为 0 时不检查；不为 0 时必须等于当前的 `spec.network_policy.revision`，否则返回 `aborted`，内容不变 |
| `drain_seconds` | 可选，只影响改变了连接走向的修改，取 0 到 3600，缺省 600，见 [Egress 与 Resolver](/integrate/native-api/egress-resolver) |

只想改其中一部分时，先读出当前策略，改好后带上读到的 `revision` 作为 `expected_revision` 提交，避免覆盖别人的修改，见[版本校验](/integrate/native-api/conventions#expected-revision)。

按 Workspace 的状态：

| 状态 | 结果 |
|---|---|
| `AVAILABLE` | `revision` 加一，RPC 在运行中的执行确认生效（或失败）之后才返回 |
| `STOPPED` | 只更新期望，下次启动时生效 |
| 其他（`CREATING`、`STARTING`、`STOPPING`、`DELETING`、`FAILED` 等） | 返回 `failed_precondition` |

- 内容与当前相同时直接成功，`revision` 不变。
- 收窄后，目的地落入新拒绝范围的已有连接无法再收发数据，其余连接不受影响。改为 `DENY_ALL` 时切断全部已有连接。
- 放宽后新连接立即可用，不需要重启 Workspace。
- 运行中的执行没能应用新策略时，Workspace 进入 `FAILED`，`network_policy_status` 消失：执行仍在运行，但出网状态已不可确认。用强制停止加启动恢复，见[强制停止](/integrate/native-api/workspaces#force-stop)。
- 策略引用的 Egress 或 Resolver 一时读不到时，返回可重试的 `unavailable`，期望已经保存而 node 上仍是原来的策略，用同一个请求重发即可。

请求示例（JSON），把 IPv4 出站限制在一段地址：

```json
{
  "metadata": {"command_id": "agent-42-network-3"},
  "workspace_id": "ws-01k6...",
  "network_policy": {
    "mode": "NETWORK_POLICY_MODE_PUBLIC_INTERNET",
    "deny": ["0.0.0.0/0", "::/0"],
    "allow": ["203.0.113.0/24"]
  },
  "expected_revision": "3"
}
```

### 生效状态 {#status}

`network_policy_status` 是 node 报告的、当前执行上已确认生效的策略。从未确认生效，或应用失败之后，它不出现。

| 字段 | 含义 |
|---|---|
| `applied_revision`、`mode` | node 上正在执行的策略 revision 与 mode |
| `draining_revision` | 还有按更早 revision 建立、仍在宽限期内的连接时，给出其中最早的 revision；没有时为 0 |
| `egresses` | 策略引用的每个 Egress 一项，见 [Egress 与 Resolver](/integrate/native-api/egress-resolver) |
| `resolvers` | 策略 `resolvers` 的每一项一项，见 [Egress 与 Resolver](/integrate/native-api/egress-resolver) |

- `applied_revision` 等于 `spec.network_policy.revision`：期望已经生效。
- `applied_revision` 小于 `spec.network_policy.revision`，而 Workspace 不是 `FAILED`：新策略已经下发，还没确认。
- 停止的 Workspace 没有当前执行，也就没有 `network_policy_status`。

## 能力名与 node 支持 {#capabilities}

| 能力名 | 对应的功能 |
|---|---|
| `workspace.network_policy.update` | `UpdateWorkspaceNetworkPolicy` |
| `workspace.network_policy.destination_rules` <Badge type="tip" text="v0.2.0 新增" /> | 策略的 `allow` 与 `deny` |
| `workspace.network_policy.update.expected_revision` <Badge type="tip" text="v0.2.0 新增" /> | `UpdateWorkspaceNetworkPolicy` 的 `expected_revision` |
| `workspace.network_policy.egress.socks5` <Badge type="tip" text="v0.3.0 新增" /> | `EgressService` 与策略的 `egresses` |
| `workspace.network_policy.resolver` <Badge type="tip" text="v0.3.0 新增" /> | `ResolverService` 与策略的 `resolvers` |

- 较旧的服务端会静默丢掉 `allow`、`deny`、`egresses`、`resolvers` 这些它不认识的字段，也会忽略 `expected_revision`。写入前先确认对应的能力名存在。
- 带 `allow` 或 `deny` 的 Workspace 只运行在支持目的地规则的 node 上，不会退回为不带规则的 `PUBLIC_INTERNET`。创建或启动时没有这样的 node，返回 `failed_precondition`，`reason` 为 `CAPABILITY_UNAVAILABLE`；运行中加规则而所在的 node 不支持时，返回同样的错误，期望不变。Egress 与 Resolver 同理。
- 部署中的 node 是否支持这些网络能力取决于部署配置，可向平台运营方确认。

## DNS {#dns}

guest 只向自己链路上的一个地址发 DNS 查询，查询去哪里由策略决定。

| 项 | 规则 |
|---|---|
| 链路 DNS 地址 | guest 网关的地址，地址族与部署的第一个 DNS 服务器相同；IPv6 时是 `fe80::1` |
| `/etc/resolv.conf` | 只有一个 `nameserver`，即链路 DNS 地址 |
| 端口 | 53，UDP 与 TCP |

| 策略 | 查询的去向 |
|---|---|
| `DENY_ALL` | 立即失败：UDP 收到端口不可达，TCP 被重置，没有报文离开 Workspace。使用未连接 UDP 套接字查询的解析库（例如 musl）会按自己的超时失败 |
| `PUBLIC_INTERNET`，不引用 Resolver | 转给与链路 DNS 地址同一地址族的第一个部署 DNS 服务器，其余的不使用 |
| `PUBLIC_INTERNET`，引用 Resolver | 按 Resolver 的协议与路径转给调用方的上游，见 [Egress 与 Resolver](/integrate/native-api/egress-resolver) |

- **`allow`、`deny` 与 `egresses` 都不作用于这些查询。** 发往链路 DNS 地址的查询照常成功，`deny` 覆盖了部署的 DNS 服务器或整个地址族时也一样；解析出的地址落在 `deny` 里时，随后的连接立即失败。只有 `resolvers` 能让查询经 Egress 离开。
- **guest 直接发往部署 DNS 服务器的 UDP 被拒绝。** 只有发往链路 DNS 地址的查询算 DNS。
- **改策略不改 guest 的 DNS 配置。** 改 mode、引用、更换或解除 Resolver，`/etc/resolv.conf` 都不变。
- **guest 每次启动重写 `/etc/resolv.conf`、`/etc/hosts` 与 `/etc/hostname`。** 在 guest 中对它们的修改不跨启动保留。
- **`v0.3.0` 之前启动的 Workspace 保持原来的 DNS 配置，直到重启。** 部署升级到 `v0.3.0` 之前启动、一直没有重启的 Workspace，`/etc/resolv.conf` 仍列出部署的 DNS 服务器，不能引用 Resolver：这样的 `UpdateWorkspaceNetworkPolicy` 返回 `failed_precondition`，`reason` 为 `CONFLICT`，期望与生效的策略都不变。停止再启动之后可以引用。

## 相关文档 {#related}

- [Egress 与 Resolver](/integrate/native-api/egress-resolver)：经调用方的出口离开，以及自选 DNS 上游。
- [Workspace](/integrate/native-api/workspaces#create)：创建时给出网络策略。
- [隔离与网络安全](/security/isolation)：Workspace 的网络隔离模型。
- [网络、Egress 与 Resolver](/integrate/kibo/network)：用 `kibo` 修改网络策略。
