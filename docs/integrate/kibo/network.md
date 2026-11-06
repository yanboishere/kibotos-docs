---
title: 网络、Egress 与 Resolver
description: 用 kibo 设置 Workspace 的网络策略：mode、allow 与 deny 规则、经调用方的 Egress 离开、把 DNS 查询交给调用方的 Resolver，以及管理 Egress 与 Resolver。
---

# 网络、Egress 与 Resolver

本页说明怎样用 `kibo` 设置 Workspace 能访问哪些外部地址：选择 mode、用 `--allow` 与 `--deny` 收窄目的地、让部分连接经调用方自己的出口（Egress）离开、把 DNS 查询交给调用方选的 DNS 上游（Resolver），以及创建和维护 Egress 与 Resolver。读者是用 `kibo` 配置网络的接入开发者。

判定顺序、DNS 的去向与故障类别的完整语义见原生 API 的[网络策略与 DNS](/integrate/native-api/network-policy)与 [Egress 与 Resolver](/integrate/native-api/egress-resolver)，本页只写 `kibo` 的用法。

## 概述 {#overview}

每个 Workspace 有一份网络策略，由下面几部分组成，任一部分变化时策略的 revision 加一：

| 部分 | 说明 |
|---|---|
| mode | `deny-all`（默认）或 `public-internet` |
| `allow`、`deny` | 目的地规则，每项一个地址或 CIDR，只用于 `public-internet` |
| Egress | 至多一个 Egress 与经它离开的目的网段，只用于 `public-internet` |
| Resolver | 至多一个 Resolver 与查询的离开路径，只用于 `public-internet` |

- `deny-all` 不放行任何出站连接，guest 的 DNS 查询立即失败。
- `public-internet` 放行 guest 发起的 TCP 连接与 `ping`。私有地址、本机地址与平台使用的特殊用途地址始终被拒绝，`--allow` 也放不开。DNS 查询只发往 guest 链路上的一个地址，由 node 转给部署的 DNS 服务器或策略引用的 Resolver，见 [DNS](/integrate/native-api/network-policy#dns)。
- 创建时用 `kibo workspace create --network` 及本页的各个参数给出策略，之后用 `kibo workspace network` 修改。
- 运行中的 Workspace 在命令返回前应用新策略，此后不再放行的目的地上的连接被切断。`STOPPED` 的 Workspace 只记录新策略，下次启动时生效。其他状态拒绝修改，返回 `failed_precondition`（退出码 `13`）。
- 带规则、Egress 或 Resolver 的 Workspace 只运行在支持这些功能的 node 上，不会退化成不带它们的 `public-internet`。没有这样的 node 时，创建或启动以 `failed_precondition` 失败。node 是否支持取决于部署配置，可向平台运营方确认。

## 修改网络策略 {#network-commands}

| 命令 | 效果 |
|---|---|
| `kibo workspace network set "$workspace_id" public-internet …` | 整体替换：命令行写的就是完整策略，没写的部分为空 |
| `kibo workspace network add "$workspace_id" …` | 把给出的条目加进策略，mode 与其他条目不变 |
| `kibo workspace network remove "$workspace_id" …` | 从策略里删掉给出的条目，mode 与其他条目不变 |

下面的命令依次只许访问一段 IPv4 地址（IPv6 全部拒绝）、封一个地址、解封它，最后关闭公网：

```bash
kibo workspace network set "$workspace_id" public-internet --deny 0.0.0.0/0 --deny ::/0 --allow 203.0.113.0/24
kibo workspace network add "$workspace_id" --deny 198.51.100.7
kibo workspace network remove "$workspace_id" --deny 198.51.100.7
kibo workspace network set "$workspace_id" deny-all
```

### 目的地规则 {#allow-deny}

- `--allow` 与 `--deny` 每次给一个地址或 CIDR，可重复，只用于 `public-internet`。两张表合计最多 256 项。
- 一个目的地在 `allow` 里就放行，即使 `deny` 也覆盖它；只在 `deny` 里的被拒绝，连接立即失败而不是超时；两张表都没有的按 mode 处理。
- 每一项只作用于自己的地址族：`deny` 里的 `0.0.0.0/0` 不影响 IPv6，两族都要收窄时同时写 `::/0`。
- 条目必须是服务端打印的规范写法：CIDR 的主机位为零，IPv4 没有前导零，IPv6 用小写压缩形式。`10.0.0.1/8` 这样的条目在发请求前被拒绝，错误信息给出规范写法。
- 发往链路 DNS 地址的查询不受这两张表影响。

判定顺序的完整说明见[目的地规则](/integrate/native-api/network-policy#destination-rules)。

### 注意 {#network-notes}

- `add` 与 `remove` 先读取当前策略，再以读到的 revision 提交。期间策略被别人改过时什么都不改，退出码 `13`，重新读取后再决定。
- `add` 已有的条目、`remove` 没有的条目只在标准错误提示，不算失败。
- `add` 只用于 `public-internet` 的 Workspace，`deny-all` 的 Workspace 先用 `set` 改 mode。改成 `deny-all` 时，规则、Egress 与 Resolver 一并清空。
- 不规范的条目、两表合计超过 256 项、在 `deny-all` 下给出条目，都在发请求前被拒绝，退出码 `2`。
- 脚本要重放 `add` 或 `remove` 时，把 `--command-id` 与第一次读到的 `--expected-revision` 一起传入。`set` 不带 `--expected-revision` 时不检查版本；带上时需要服务端宣告 `workspace.network_policy.update.expected_revision`。当前 revision 见 `kibo workspace get --wide` 的 `Revisions` 一节，或 JSON 的 `.result.spec.network_policy.revision`。
- 带 `--allow` 或 `--deny` 的修改需要服务端宣告 `workspace.network_policy.destination_rules`，否则退出码 `14`，不会提交一个丢了规则、比期望更宽的策略。

## 经 Egress 离开 <Badge type="tip" text="v0.3.0 新增" /> {#egress-routing}

`public-internet` 的策略可以引用一个 Egress，并写明经它离开的目的网段。目的地落在这些网段里的新建 TCP 连接经 Egress 转发，其余照常直出。Egress 本身的创建见[管理 Egress](#egress)。

```bash
kibo workspace network set "$workspace_id" public-internet --egress "$egress_id" --egress-destination 0.0.0.0/0 --egress-destination ::/0
kibo workspace network add "$workspace_id" --egress-destination 10.0.0.0/8
kibo workspace network remove "$workspace_id" --egress-destination 10.0.0.0/8
kibo workspace network remove "$workspace_id" --egress "$egress_id"
```

| 命令 | 对 Egress 的效果 |
|---|---|
| `network set`、`workspace create` | `--egress` 加至少一个 `--egress-destination` 写入一项；不带 `--egress` 时策略不引用 Egress |
| `network add` | 策略还没有 Egress 时，`--egress` 加 `--egress-destination` 引用它；已有时 `--egress-destination` 给它加网段，`--egress` 只能写同一个 ID |
| `network remove` | `--egress-destination` 删掉网段，至少留一条；只写 `--egress` 时解除引用，这些网段恢复直出 |

- 一个策略至多引用一个 Egress，网段 1 到 256 条，写法与 `--allow`、`--deny` 相同，各自只作用于本地址族。要换另一个 Egress，用 `network set`。
- 网段可以写私网与平台网段：经 Egress 的连接从调用方的网络离开，不受直出时的私网拒绝约束。`--deny` 仍然先生效（同时在 `--allow` 里的除外）。
- 网段只转发 TCP。DNS 只在 Resolver 的路径指名这个 Egress 时经它离开；发往这些网段的 `ping` 直接被拒绝。
- 转发失败时 guest 的连接被重置，不会改为直出。
- `add` 与 `remove` 编辑 `--allow`、`--deny` 时保留已有的 Egress 项。被 Resolver 路径指名的 Egress 只能与 `--resolver` 一起解除引用。
- 服务端没有宣告 `workspace.network_policy.egress.socks5` 时，带 Egress 或 `--drain-seconds` 的命令退出码 `14`，不发请求。读到的策略已引用 Egress 时，`add` 与 `remove` 同样要求这个能力。

### 切换走向时的宽限期 {#drain}

改变连接走向的更新（直出改为经 Egress、反过来，或换掉网段）不立即切断已有连接：

- 新连接立即按新策略建立，旧连接沿原路径继续传输，`--drain-seconds` 秒后关闭。
- `--drain-seconds` 取 `0` 到 `3600`，不传时为 `600`，`0` 表示切换时立即关闭。它只作用于这一次更新；宽限期内再次修改不延长更早的截止时间。
- 新的 mode、`--allow` 或 `--deny` 不再放行的连接不等宽限期，立即终止。
- 宽限期内，`workspace get` 的 `Network` 一行附 `connections of revision N still draining`。

## 自选 Resolver <Badge type="tip" text="v0.3.0 新增" /> {#resolver-routing}

guest 只向自己链路上的一个地址发 DNS 查询。不引用 Resolver 时查询转给部署的 DNS 服务器；`public-internet` 的策略引用一个 Resolver 后，查询转给它。Resolver 本身的创建见[管理 Resolver](#resolver)。

```bash
kibo workspace network set "$workspace_id" public-internet --resolver "$resolver_id" --resolver-path direct
kibo workspace network add "$workspace_id" --egress "$egress_id" --egress-destination 10.0.0.0/8 --resolver "$resolver_id" --resolver-path "egress:$egress_id"
kibo workspace network remove "$workspace_id" --resolver "$resolver_id"
```

`--resolver-path` 决定到上游的连接怎么离开，没有默认值：

| 写法 | 到上游的连接 |
|---|---|
| `direct` | 从 node 的上联地址发出。上游是私网、本机或平台地址时被拒绝 |
| `egress:<egress-id>` | 经同一策略用 `--egress` 引用的这个 Egress 离开，可以访问 Egress 所在网络里的私网 DNS 服务器。与 `--egress-destination` 是否覆盖上游无关 |

| 命令 | 对 Resolver 的效果 |
|---|---|
| `network set`、`workspace create` | `--resolver` 加 `--resolver-path` 写入一项；不带 `--resolver` 时查询转给部署的 DNS 服务器 |
| `network add` | 策略还没有 Resolver 时引用它；已有时只能写同一个 ID 与路径。换 Resolver 或改路径用 `set` |
| `network remove` | `--resolver` 解除引用，查询回到部署的 DNS 服务器 |

- 一个策略至多引用一个 Resolver，只用于 `public-internet`。
- `udp` Resolver 经 Egress 时，那个 Egress 要用 `kibo egress update --udp` 开启 UDP。
- 上游不可用时查询得到 `SERVFAIL`，不会改用部署的 DNS 服务器。
- 引用、更换或解除 Resolver 都不改写 guest 的 `/etc/resolv.conf`。
- 由较早版本启动、仍在运行的 Workspace 保持原来的 DNS 配置，引用 Resolver 的修改以 `failed_precondition` 失败；停止再启动后可以引用。
- 服务端没有宣告 `workspace.network_policy.resolver` 时，带 Resolver 的命令退出码 `14`，不发请求。读到的策略已引用 Resolver 时，`add` 与 `remove` 同样要求这个能力。

## 管理 Egress <Badge type="tip" text="v0.3.0 新增" /> {#egress}

Egress 是调用方运营的 SOCKS5 端点。Workspace 的网络策略引用它之后，发往指定网段的 TCP 连接从调用方的网络离开。一个 Egress 可以被多个 Workspace 引用。服务端需要宣告 `workspace.network_policy.egress.socks5`，否则 `kibo egress` 的命令退出码 `14`。

```bash
egress_id=$(kibo egress create --address proxy.example.com:1080 --username alice --password-file ./proxy-password --label team=infra -q)
kibo egress get "$egress_id"
kibo egress list -l team=infra
```

### 参数 {#egress-flags}

`create` 与 `update` 用同一组参数描述完整的端点：

| 参数 | 说明 |
|---|---|
| `--address` | 必填，`host:port`，host 是 IP 地址或主机名。写成私网、本机或平台地址，或主机名解析到这些地址时被拒绝；node 每次拨号时还会再检查一次。每条转发的连接以 SOCKS5 `CONNECT` 请求 guest 拨的地址 |
| `--username` | SOCKS5 用户名，1 到 255 字节，按 RFC 1929 认证。给了用户名就必须有口令，反之亦然 |
| `--password-stdin` | 从标准输入读口令 |
| `--password-file` | 从文件读口令 |
| `--tls` | SOCKS5 协商与转发的流量都在 TLS 内 |
| `--tls-server-name` | SNI 与证书校验用的名字，不传时取 `--address` 的 host。给出即开启 TLS |
| `--tls-ca-cert-file` | PEM 文件，至多 64 KiB，给出时替代系统信任库。给出即开启 TLS |
| `--udp` | 允许引用它的策略让 `udp` Resolver 的查询经它离开，用 `UDP ASSOCIATE` 承载。**即使开启 TLS，UDP 数据报也以明文发往端点回答的中继地址** |
| `--label`、`--annotation` | 只用于 `create`，规则与 Workspace 的相同，见[管理 Workspace](/integrate/kibo/workspaces) |

`kibo egress get` 显示协议（`socks5`）、地址、`Credentials`（只说明有没有口令，例如 `username alice with a password (not shown)`）、TLS 与 UDP 的设置、revision 与创建时间；`list` 的列是 `EGRESS`、`PROTOCOL`、`ADDRESS`、`TLS`、`REVISION`。

### 口令 {#egress-password}

口令没有直接写值的参数，避免进入命令历史与进程列表：

- 只给 `--username` 时，在终端上不回显地提示 `Egress password:`；没有终端时退出码 `2`，改用 `--password-stdin` 或 `--password-file`。
- 标准输入与文件末尾的一个换行（`\n` 或 `\r\n`）被去掉，其余字符原样作为口令，可以含空格。口令 1 到 255 字节。
- 口令只写不读：`get`、`list`、命令输出、错误信息与 JSON 结果都不显示它。
- `--password` 在任何命令上都被拒绝。

### 更新 {#egress-update}

```bash
kibo egress update "$egress_id" --address proxy.example.com:1080 --username alice --password-file ./proxy-password --drain-seconds 60
```

- `update` 整体替换端点、凭证、TLS 与 UDP 设置，没写的参数为空。口令读不回来，每次更新都要重新给出。
- 还有策略经它转发 `udp` Resolver 的查询时，不带 `--udp` 的更新被拒绝，退出码 `13`。
- 不传 `--expected-revision` 时先读取当前 revision 再提交，期间被别人改过时退出码 `13`。传 `--command-id` 时必须同时传 `--expected-revision`。
- 内容相同时 revision 不变，不同时加一。命令在保存后返回，不等待 Workspace：引用它的运行中 Workspace 随后把新连接切到新 revision，`workspace get` 的 `Egress applied` 一行显示切换结果。
- 经旧 revision 建立的连接继续传输 `--drain-seconds` 秒后关闭，取值与网络策略的相同。

### 删除 {#egress-delete}

```bash
kibo workspace network remove "$workspace_id" --egress "$egress_id"
kibo egress delete "$egress_id"
```

- 还有未删除的 Workspace 引用它时，删除被拒绝，退出码 `13`。先解除引用。
- 删除不需要确认。删除后，仍经它在宽限期内的连接立即关闭；已删除的 Egress 对所有读取与引用都返回 `not_found`。

## 管理 Resolver <Badge type="tip" text="v0.3.0 新增" /> {#resolver}

Resolver 是调用方选的 DNS 服务器。Workspace 的网络策略引用它之后，guest 的 DNS 查询转给它。一个 Resolver 可以被多个 Workspace 引用。服务端需要宣告 `workspace.network_policy.resolver`，否则 `kibo resolver` 的命令退出码 `14`。

```bash
resolver_id=$(kibo resolver create --https https://dns.example.com/dns-query --label team=infra -q)
kibo resolver get "$resolver_id"
kibo resolver list -l team=infra
```

### 协议与上游 {#resolver-protocols}

`create` 与 `update` 必须给出下面一个参数，它同时决定协议与上游：

| 参数 | 上游 |
|---|---|
| `--udp` | IP 地址或 `IP:port`，端口缺省 `53`，不接受主机名。guest 经 TCP 发来的查询经 TCP 发往同一地址 |
| `--tcp` | IP 地址或 `IP:port`，端口缺省 `53`，不接受主机名 |
| `--tls` | DNS over TLS，`host` 或 `host:port`，端口缺省 `853`，host 可以是主机名 |
| `--https` | DNS over HTTPS（`POST`），`https://host[:port]/path`，端口缺省 `443`，不能带用户信息、查询串与片段 |

- IP 地址按服务端的规范写法：没有前导零，IPv6 用小写压缩形式，带端口时写在方括号里，例如 `[2001:db8::53]:53`。写法不对在发请求前被拒绝，退出码 `2`。
- `--tls` 与 `--https` 的 host 也是校验证书的名字，用系统信任库校验。host 是 IP 地址时，证书要带这个地址。
- Resolver 没有凭证，读取原样返回全部内容，包括 URL 路径。不要把密钥或令牌放进路径。
- `--label`、`--annotation` 只用于 `create`。
- `get` 显示协议、上游、revision 与创建时间；`list` 的列是 `RESOLVER`、`PROTOCOL`、`UPSTREAM`、`REVISION`。

### 更新与删除 {#resolver-update}

```bash
kibo resolver update "$resolver_id" --tls dns.example.com
kibo workspace network remove "$workspace_id" --resolver "$resolver_id"
kibo resolver delete "$resolver_id"
```

- `update` 整体替换协议与上游。内容相同时 revision 不变，不同时加一。
- 不传 `--expected-revision` 时先读取当前 revision 再提交，期间被别人改过时退出码 `13`。传 `--command-id` 时必须同时传 `--expected-revision`。
- 命令在保存后返回，不等待 Workspace：引用它的运行中 Workspace 随后把新查询发往新 revision，`workspace get` 的 `Resolver applied` 一行显示切换结果。已经发出的查询按原配置完成。
- 还有 Workspace 以 `direct` 路径引用它时，改成私网、本机或平台地址的更新被拒绝。
- 还有未删除的 Workspace 引用它时，删除被拒绝，退出码 `13`。先解除引用。删除不需要确认。

## workspace get 里的网络信息 {#workspace-get}

`kibo workspace get` 用下面几行显示网络策略与它在运行中的生效情况：

| 行 | 内容 |
|---|---|
| `Network` | 期望的 mode。运行中的 Workspace 还没有确认应用时附 `(not confirmed yet)`；已应用的是旧策略时附 `(applied: <mode>, change pending)`；还有旧 revision 的连接在宽限期内时附 `connections of revision N still draining` |
| `Allow`、`Deny` | 两张表的条目，每个一行，为空时省略 |
| `Egress`、`Via Egress` | 策略引用的 Egress 与它的网段，网段每条一行 |
| `Resolver` | 策略引用的 Resolver 与它的路径，例如 `rsv-01k6… path direct` |
| `Egress applied` | 只在运行中显示：每个 Egress 新连接所用的 Egress revision；旧 revision 的连接还在宽限期内时附上那个 revision |
| `Egress fault` | 出口自身的故障：`ENDPOINT_UNREACHABLE`、`TLS_VERIFICATION_FAILED`、`HANDSHAKE_FAILED`、`AUTHENTICATION_FAILED`、`UDP_ASSOCIATION_FAILED`，以及这一轮连续故障开始的时间。下一次经 Egress 的连接成功后消失 |
| `Resolver applied` | 只在运行中显示：新查询所用的 Resolver revision |
| `Resolver fault` | 上游这一段的故障：`UPSTREAM_UNREACHABLE`、`UPSTREAM_TIMEOUT`、`TLS_VERIFICATION_FAILED`、`HTTP_ERROR_STATUS`，以及这一轮连续故障开始的时间。下一次查询成功后消失 |

- 期望策略与已应用策略的 revision 在 `--wide` 的 `Revisions` 一节与 JSON 输出中。
- JSON 输出里对应 `spec.network_policy`、`network_policy_status`（含 `applied_revision`、`draining_revision`、`egresses`、`resolvers`）、`egress_observations` 与 `resolver_observations`。
- 没有 `AUTHENTICATION_FAILED` 不说明凭证正确：端点对错误凭证不作应答时，故障显示为 `ENDPOINT_UNREACHABLE` 或 `HANDSHAKE_FAILED`。`kibo` 不认识的故障类别显示为 `UNKNOWN_FAULT(n)`，同样是故障。
- 上游正常回答的 `NXDOMAIN` 与 `SERVFAIL` 不算故障。经 Egress 时 Egress 自身的故障只出现在 `Egress fault` 一行。
- 故障是观测，不改变 Workspace 的状态。从故障出现到能读到，一般在 2 分钟以内。

## 下一步 {#next-steps}

- [网络策略与 DNS](/integrate/native-api/network-policy)
- [Egress 与 Resolver](/integrate/native-api/egress-resolver)
- [隔离与网络安全](/security/isolation)
- [管理 Workspace](/integrate/kibo/workspaces)
