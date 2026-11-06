---
title: 出网策略与出站代理
description: 通过 E2B 兼容 API 控制 sandbox 的出站网络：出网开关、allowOut 与 denyOut 的地址规则、修改语义、IPv6 与 DNS 行为，以及经调用方自己的 SOCKS5 代理出网。
---

# 出网策略与出站代理

本页说明怎样控制 sandbox 能访问哪些外部地址：出网开关、按地址或网段放行与拒绝、修改策略时的语义与返回时机，以及让 sandbox 的出站 TCP 经你自己的 SOCKS5 代理离开。读者是需要限制 Agent 出网范围、或让出网流量经企业出口的开发者与安全评审。

E2B 的出网选项会被翻译成 Kibotos 的原生网络策略。原生策略的完整规则见[网络策略与 DNS](/integrate/native-api/network-policy)。

## 设置方式 {#configure}

| 时机 | SDK | REST |
|---|---|---|
| 创建时 | 创建参数 `allowInternetAccess` 与 `network.allowOut`、`network.denyOut`、`network.egressProxy` | `POST /sandboxes` 的 `allow_internet_access` 与 `network` |
| 运行中修改 | `sandbox.updateNetwork({ allowInternetAccess, allowOut, denyOut, egressProxy })` | `PUT /sandboxes/{id}/network`，请求体字段为 `allow_internet_access`、`allowOut`、`denyOut`、`egressProxy`、`rules` |

```javascript
import { ALL_TRAFFIC, Sandbox } from 'e2b';

// 创建时关闭公网，只放行一个地址和一个网段
const sandbox = await Sandbox.create('kibotos-minimal', {
  ...config,
  allowInternetAccess: false,
  network: { allowOut: ['203.0.113.10', '198.51.100.0/24'], allowPublicTraffic: false },
});

// 运行中改为拒绝全部出网
await sandbox.updateNetwork({ denyOut: [ALL_TRAFFIC] });

// 重新打开公网访问，同时清空全部条目
await sandbox.updateNetwork({ allowInternetAccess: true });
console.log((await sandbox.getInfo()).allowInternetAccess); // true
```

用 REST 修改，成功返回 204，没有响应体：

```bash
curl -sS -X PUT "$E2B_API_URL/sandboxes/$sandbox_id/network" \
  -H "X-API-Key: $(cat "$E2B_API_KEY_FILE")" \
  -H 'Content-Type: application/json' \
  --data '{"allow_internet_access":false,"allowOut":["203.0.113.10"]}' \
  -o /dev/null -w '%{http_code}\n'
```

修改请求体里出现上表以外的字段返回 400，`allow_internet_access` 不是布尔值同样返回 400。`network` 里的 `allowPublicTraffic` 与 `maskRequestHost` 控制的是入站的应用端口，只能在创建时设置，见 [sandbox 生命周期](/integrate/e2b/sandboxes)。

## 与原生策略的映射 {#mapping}

| 请求 | Kibotos 的网络策略 |
|---|---|
| 拒绝全部 IPv4，不带 `allowOut`、不带 `egressProxy` | `DENY_ALL`：全部出站被拒绝，DNS 与 ping 也被拒绝 |
| 拒绝全部 IPv4，带 `allowOut` | `PUBLIC_INTERNET`，`deny` 为 `denyOut` 加上 `0.0.0.0/0` 与 `::/0`，`allow` 为 `allowOut`：只放行 `allowOut` 里的地址 |
| 其余请求 | `PUBLIC_INTERNET`，`allowOut` 与 `denyOut` 原样作为 `allow` 与 `deny` |

- **拒绝全部 IPv4** 指 `allowInternetAccess: false`，或 `denyOut` 含 `0.0.0.0/0`（SDK 的 `ALL_TRAFFIC`）。
- 一个目的地址按这个顺序判定：私有地址与特殊用途地址一律拒绝；在 `allow` 里则放行；在 `deny` 里则拒绝；其余放行。私有与特殊用途地址写进 `allowOut` 也放不开。详见[判定顺序](/integrate/native-api/network-policy#destination-rules)。
- 被拒绝的连接立即失败，不会等到超时。

## 整体替换语义 {#replace}

与 E2B 一样，每次修改都整体替换出站配置，请求里没有给出的字段被清空：

- **不带 `allowInternetAccess` 视为不拒绝。** 只带 `denyOut` 的修改会重新打开此前关闭的公网访问。要保持关闭，每次修改都带上 `allowInternetAccess: false` 或 `ALL_TRAFFIC`。
- **空的修改**（`updateNetwork({})`）清空全部条目，打开公网访问，并清除出站代理。
- **出站代理也一样。** 修改时不带 `egressProxy` 会清除代理，见[出站代理](#egress-proxy)。

::: warning 注意
修改出网策略前先想清楚完整的目标配置，再一次写全。只想调整其中一项时，也要把其余需要保留的设置一起带上。
:::

修改对连接的影响：

- 收窄后，目的地落入新拒绝范围的已有连接无法再收发数据，其余连接不受影响。改成全部拒绝时切断全部已有连接。
- 放宽后，新连接立即可用，不需要重启 sandbox。

其他规则：

- 只能修改运行中的 sandbox，其他状态返回 409 `network can only change for a running sandbox`。暂停中的 sandbox 要先 `connect` 恢复。
- 修改不延长 sandbox 的有效期，也不更换 token。
- 修改接受 `Idempotency-Key`，见[幂等](/integrate/e2b/sandboxes)。

## 条目写法与上限 {#entries}

条目写法与 E2B 相同：

- 每项是一个 IP 地址或一个 CIDR。
- `denyOut` 不接受域名，写了域名返回 400，消息为 `invalid denied CIDR <条目>`。
- `allowOut` 里的域名与域名模式暂不支持：与 E2B 一样，`denyOut` 不含 `ALL_TRAFFIC` 时先返回 400；含 `ALL_TRAFFIC` 时返回 501，能力名 `network egress allowlist domains`。
- 未指定地址中只接受 `0.0.0.0/0`（`ALL_TRAFFIC`），`::/0` 返回 400。
- 带主机位的 CIDR（例如 `10.1.2.3/8`）按它的网络地址生效，查询仍回显你写的原样。
- `allowOut` 与 `denyOut` 两张表合计最多 256 项，网关为拒绝全部出网补上的 `0.0.0.0/0` 与 `::/0` 也计入，超出返回 400。
- `rules`（按域名改写请求等规则）返回 501，能力名 `network egress rules`。

## IPv6 {#ipv6}

E2B 的 sandbox 只有 IPv4 出网，在 E2B 上拒绝全部 IPv4 就是拒绝全部出网。所以网关在拒绝全部 IPv4 时同时拒绝 IPv6。

其余请求的条目只作用于自己的地址族。例如只写 `denyOut: ['203.0.113.0/24']` 时，IPv6 出网不受影响。部署是否提供 IPv6 出网取决于部署配置，可以向平台运营方确认；需要同时限制 IPv6 时，在 `denyOut` 里写出具体的 IPv6 网段，或直接关闭公网访问再用 `allowOut` 放行。

## DNS {#dns}

sandbox 的 DNS 查询只发往 guest 链路上的一个地址（`/etc/resolv.conf` 里唯一的 `nameserver`），由 node 转给部署的 DNS 服务器。这带来两点与 E2B 不同的行为：

- **带 `allowOut` 或 `denyOut` 时，DNS 查询仍然可用。** 两张表都不影响 DNS 查询。在 E2B 上这时 DNS 也被拒绝，除非 `allowOut` 包含解析服务器。解析出的地址被拒绝时，随后的连接立即失败。
- **全部拒绝（`DENY_ALL`）时，DNS 查询立即失败**，没有报文离开 sandbox。使用未 connect 的 UDP 套接字查询的解析库（例如 musl，Alpine 系的镜像使用它）不会立即报错，而是等到自己的超时才失败。

DNS 的完整行为见 [DNS](/integrate/native-api/network-policy#dns)。

## 修改的返回时机 {#update-timing}

网关确认新策略已经在 sandbox 所在的 node 上生效后才返回 204，最多等待 30 秒：

| 结果 | 含义与处理 |
|---|---|
| 204 | 新策略已生效 |
| 500，消息说修改没有被确认生效 | 30 秒内没能确认，修改可能已经被接受。用 `getInfo()` 读取当前配置后再决定是否重试 |
| 409 | 并发修改冲突、等待期间 sandbox 停止、sandbox 不在运行，或同一个 `Idempotency-Key` 换了请求内容。读取当前状态后再决定下一步 |
| 400 | 请求不合法，例如条目写法错误、超过 256 项 |
| 501 | 请求了不支持的能力，见下一节 |
| 404 | sandbox 不存在 |

## 部署的网络能力 {#deployment-capabilities}

按地址的规则与出站代理需要部署支持，取决于部署配置，可以向平台运营方确认：

- 部署不支持按地址的出站规则时，带 `allowOut` 或 `denyOut` 条目的请求返回 501，能力名 `network egress allow and deny lists`，不会退化成只按开关生效。
- 部署不支持出站代理时，带 `egressProxy` 的请求返回 501，能力名 `network egress proxy`，不会退化成直连。
- 带条目或代理的 sandbox 只运行在支持这些能力的 node 上。部署里暂时没有这样的 node 时，创建或恢复返回 409。

## 出站代理 {#egress-proxy}

`network.egressProxy` 让 sandbox 的出站 TCP 经你自己运营的 SOCKS5 代理离开，例如为了使用企业的固定出口 IP 或经过审计网关。创建时在 `network.egressProxy` 里给出，运行中用 `updateNetwork({ egressProxy })` 修改。网关把代理保存为 Kibotos 的一个 Egress，在网络策略里引用它，目的网段为 `0.0.0.0/0` 与 `::/0`。Egress 的原生用法见 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。

```javascript
import { readFile } from 'node:fs/promises';
import { Sandbox } from 'e2b';

const proxy = {
  address: 'proxy.example.com:1080',
  username: 'agent-egress',
  password: (await readFile(process.env.PROXY_PASSWORD_FILE, 'utf8')).trim(),
};

const sandbox = await Sandbox.create('kibotos-minimal', { ...config, network: { egressProxy: proxy } });

// 读取只返回地址与用户名
console.log((await sandbox.getInfo()).network?.egressProxy); // { address: 'proxy.example.com:1080', username: 'agent-egress' }

// 换成另一台代理：每次都要带上口令
await sandbox.updateNetwork({ egressProxy: { ...proxy, address: 'proxy-2.example.com:1080' } });

// 清除代理，恢复直连
await sandbox.updateNetwork({});
```

上例的 `PROXY_PASSWORD_FILE` 指向保存代理口令的文件，由你自己准备。

### 字段与校验 {#egress-proxy-fields}

| 字段 | 规则 |
|---|---|
| `address` | 必填，`host:port`，host 是主机名或 IP 地址，端口 1 到 65535。地址落在私有或特殊用途网段，或主机名解析到这些网段时，返回 400 |
| `username`、`password` | 可选，各最长 255 字节，按 RFC 1929 认证。只给 `password` 返回 400；只给 `username` 返回 501，能力名 `network egress proxy username without a password` |

- `egressProxy` 里出现其他字段返回 400。
- SDK 的 `egressProxy` 只有这三个字段，没有 TLS 设置，到代理的连接不使用 TLS。

::: warning 注意
到代理的连接不加密，RFC 1929 的用户名与口令也以明文发送。只在可信的网络路径上使用带口令的代理，并为它单独设置口令。
:::

### 转发范围 {#egress-proxy-scope}

- **先判定 `denyOut`。** 被 `denyOut` 拒绝的连接不会到达代理。其余新建的 TCP 连接全部经代理离开，不做私有地址的拦截，所以代理所在网络里的地址也能连到。
- **不经代理的流量。** DNS 查询仍发往链路 DNS 地址，由 node 转给部署的 DNS 服务器，不经代理。其他 UDP 本来就不放行，也不经代理。到被代理目的地的 ping 被拒绝。
- **代理不可用时不回退。** 代理连不上、协商或认证失败时，连接直接失败，不会改为直连。
- **全部拒绝又带代理。** 这时策略不能是 `DENY_ALL`，网关改用 `PUBLIC_INTERNET`，`deny` 为 `0.0.0.0/0` 与 `::/0`。效果仍是全部连接被拒绝，只有 DNS 查询可用。

### 读取与修改 {#egress-proxy-update}

- **口令只写。** `getInfo()` 与列表的 `network.egressProxy` 只回显 `address` 与 `username`，任何读取都不返回口令。
- **替换代理。** 带 `egressProxy` 的修改原地更新这个 sandbox 的代理配置，每次都要带上口令。sandbox 原来没有代理时新建一个。网关等新配置在 node 上生效后才返回 204，之后的新连接使用新代理。
- **清除代理。** 修改时不带 `egressProxy` 即清除代理。网关先解除引用、确认生效，再删除保存的代理配置。
- **已有的连接。** 替换或清除代理后，经原来的配置建立的连接按原生的宽限期继续传输一段时间后关闭，默认 600 秒，见 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。
- **整体替换。** 修改代理时同样整体替换出站配置，记得同时带上需要保留的 `allowInternetAccess`、`allowOut` 与 `denyOut`。
- **其他客户端设置的出口。** sandbox 的策略被其他客户端经原生 API 改成引用别的 Egress 时，网关修改网络只解除这个引用，不修改也不删除那个 Egress。

### 清理 {#egress-proxy-cleanup}

- 经网关删除 sandbox 时，网关随即删除它的代理配置。
- 到期被删除的 sandbox 留下的代理配置，以及请求中途失败留下的代理配置，由每个网关实例每 5 分钟一次的清理删除。创建不满 10 分钟的代理配置不在清理范围内，所以它们最长会在 sandbox 删除后保留十几分钟。

## 相关文档 {#related}

- [网络策略与 DNS](/integrate/native-api/network-policy)
- [Egress 与 Resolver](/integrate/native-api/egress-resolver)
- [隔离与网络安全](/security/isolation)
- [与 E2B 的差异](/integrate/e2b/differences)
