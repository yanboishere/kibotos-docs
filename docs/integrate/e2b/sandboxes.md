---
title: sandbox 生命周期
description: 通过 E2B 兼容 API 创建、查询、列出与删除 sandbox，设置到期时间，以及用 Idempotency-Key 安全地重试。
---

# sandbox 生命周期

本页说明 sandbox 从创建到删除的每一步：创建时能用哪些选项、资源怎样分配、查询与列表返回什么、到期时间怎样计算、请求结果不明时怎样安全重试。读者是用 E2B SDK 或 E2B REST 协议管理 sandbox 的开发者。

暂停与恢复单独成页，见[暂停与恢复](/integrate/e2b/pause-resume)。本页的 SDK 示例沿用[快速开始](/quickstart/e2b-sdk)里的 `config` 对象，REST 示例使用其中的 `E2B_API_URL` 与 `E2B_API_KEY_FILE` 两个环境变量。

## 创建 {#create}

用 SDK 创建一个私有、到期删除的 sandbox：

```javascript
import { Sandbox } from 'e2b';

const sandbox = await Sandbox.create('kibotos-minimal', {
  ...config,
  timeoutMs: 30 * 60_000,
  lifecycle: { onTimeout: 'kill', autoResume: false },
  metadata: { tenant: 'acme', task: 'report-20261106' },
  network: { allowPublicTraffic: false },
});
console.log(sandbox.sandboxId);
```

同样的请求用 REST 发送：

```bash
curl -sS -X POST "$E2B_API_URL/sandboxes" \
  -H "X-API-Key: $(cat "$E2B_API_KEY_FILE")" \
  -H 'Content-Type: application/json' \
  --data '{"templateID":"kibotos-minimal","timeout":1800,"autoPause":false,"metadata":{"tenant":"acme","task":"report-20261106"},"network":{"allowPublicTraffic":false}}'
```

创建是同步的：网关等 sandbox 就绪、可以执行命令之后才返回 201，最长等待约 90 秒。SDK 的 `requestTimeoutMs` 要比这更长，例如 `120_000`。

### 请求参数 {#create-parameters}

`POST /sandboxes` 的请求体最多 1 MiB。SDK 参数与 REST 字段的对应如下：

| REST 字段 | SDK 参数 | 说明 |
|---|---|---|
| `templateID` | `Sandbox.create()` 的第一个参数 | 必填。Template ID，以平台运营方提供的为准 |
| `timeout` | `timeoutMs`（毫秒） | 有效期，单位秒。省略时用部署的默认值（默认 1 小时，取决于部署配置）。`0` 与负数表示立即到期。见[到期时间](#expiration) |
| `autoPause` | `lifecycle.onTimeout: 'pause'` | `true` 时到期暂停而不是删除，见[暂停与恢复](/integrate/e2b/pause-resume) |
| `autoPauseMemory` | 无 | 只能与 `autoPause: true` 同时出现，否则返回 400。两个取值都按冷暂停处理；SDK `lifecycle.onTimeout` 里的 `keepMemory` 同样不改变行为 |
| `autoResume` | `lifecycle.autoResume` | `{"enabled": true}` 返回 501，见[被拒绝的选项](#rejected-options) |
| `metadata` | `metadata` | 字符串到字符串的映射，见 [metadata](#metadata) |
| `secure` | `secure` | 保存，但不改变认证：envd 请求总是需要 envd access token |
| `allow_internet_access` | `allowInternetAccess` | 出网开关。SDK 总是发送这个字段，默认 `true` |
| `network` | `network` | `allowPublicTraffic`、`maskRequestHost`、`allowOut`、`denyOut`、`egressProxy`、`rules`，见下文与[出网策略与出站代理](/integrate/e2b/network) |
| `volumeMounts` | `volumeMounts` | 至多一项 `{"name": ..., "path": ...}`，见 [Volume](/integrate/e2b/volumes) |
| `envVars`、`iam`、`mcp`、`snapshotID` | `envs`、`iam` 等 | 非空时返回 501 |

### 响应 {#create-response}

创建成功返回 201，响应体字段如下。`connect` 的响应体相同：

| 字段 | 说明 |
|---|---|
| `sandboxID` | sandbox ID，也是 Kibotos 的 Workspace ID，形如 `ws-01k6...` |
| `templateID` | Template ID |
| `envdAccessToken` | envd access token，envd 请求的 `X-Access-Token` |
| `trafficAccessToken` | traffic token，私有 sandbox 应用端口的 `e2b-traffic-access-token` |
| `domain` | sandbox 域名 |
| `envdVersion` | 网关报告的 envd 协议版本，当前为 `0.6.4` |
| `clientID` | 已弃用的字段，总是空字符串 |

创建没有成功时，sandbox 不一定不存在：

- 返回 503（容量不足）时，sandbox 可能已经创建，并以暂停状态留下，见[容量不足时的恢复](/integrate/e2b/pause-resume#capacity)。
- 等待超过约 90 秒或连接中断时，sandbox 可能在之后完成创建。

所以创建时总是带上能唯一标识这次请求的 metadata，失败后按 metadata 列出并清理；或者带上 `Idempotency-Key` 重试，见[幂等](#idempotency)。

### 资源 {#resources}

E2B 的创建请求不带资源字段。网关按部署的默认值为每个新 sandbox 申请资源：

| 资源 | 默认值 |
|---|---|
| CPU | 1 核 |
| 内存 | 1 GiB |
| 根文件系统的可写空间 | 5 GiB |

默认值取决于部署配置，可以向平台运营方确认。部署修改默认值只影响之后创建的 sandbox。

查询与列表返回 sandbox 实际得到的资源：

| 字段 | 含义 |
|---|---|
| `cpuCount` | CPU 核数，不足一核的部分向上取整 |
| `memoryMB` | 内存，单位 MiB |
| `diskSizeMB` | 根文件系统的可写空间，单位 MiB，是 node 确认过的值。sandbox 正在启动、或从未调度成功时还没有确认的值，这时为 `0` |

- `diskSizeMB` 不包括 Volume 的容量。挂在 `/data` 的 Volume 与独立 Volume 的容量取决于部署配置。
- 可写空间从调度时起占用部署的存储容量，暂停期间也不释放，直到 sandbox 删除。实际写入的数据才占用磁盘。

### 被拒绝的选项 {#rejected-options}

官方 SDK 会把调用方设置的选项全部发出。网关无法实现的选项让创建失败，而不是忽略它们后返回 201，因为创建响应不回显这些字段，调用方无从知道选项没有生效。

| 字段（SDK 参数） | 条件 | 结果 |
|---|---|---|
| `envVars`（`envs`） | 非空 | 501，能力名 `sandbox environment variables` |
| `iam` | 非空 | 501，能力名 `IAM tokens` |
| `mcp` | 非空 | 501，能力名 `MCP configuration` |
| `autoResume`（`lifecycle.autoResume: true`） | `enabled` 为 `true` | 501，能力名 `autoResume` |
| `snapshotID` | 非空 | 501，能力名 `snapshot restore` |
| `network.allowOut` | 含域名，`denyOut` 含 `0.0.0.0/0` | 501，能力名 `network egress allowlist domains` |
| `network.allowOut` | 含域名，`denyOut` 不含 `0.0.0.0/0` | 400，提示与 E2B 相同 |
| `network.rules` | 非空 | 501，能力名 `network egress rules` |
| `network.egressProxy` | 只有 `username`，没有 `password` | 501，能力名 `network egress proxy username without a password` |
| `autoPauseMemory` | 没有同时设置 `autoPause: true` | 400 |
| `volumeMounts` | 多于一项 | 400 |

- 字段缺省、为 `null`、空对象或空数组都视为没有设置，正常创建。
- 检查在写入任何状态、调用任何原生 API 之前完成，被拒绝的请求不会留下资源。
- 501 的响应体是 `{"code":501,"message":"create sandbox: unimplemented: <能力名> is not supported by the core gateway"}`。官方 SDK 抛出 `SandboxError`，消息以 `501: ` 开头。
- 部署不支持按地址的出网规则或出站代理时，带这些字段的创建同样返回 501，见[出网策略与出站代理](/integrate/e2b/network)。

一个请求可能同时触发多条规则，只返回其中一条。全部未提供的能力见[明确未提供的能力](/integrate/e2b/differences#unsupported)。

### 请求 Host 改写 {#mask-request-host}

`network.maskRequestHost` 改写应用端口请求的 Host 头。规则如下：

- 缺省、`null` 或空字符串：应用收到请求原来的 Host，即 `<port>-<sandboxID>.<domain>`。
- 合法的非空字符串：保存下来，之后应用端口的 HTTP 与 WebSocket 请求都按它改写 Host，其中的 `${PORT}` 替换为请求访问的端口号。例如 `localhost:${PORT}` 让访问 8080 端口的请求带着 `Host: localhost:8080` 到达应用。
- 合法的写法是 `host`、`host:port`、`[IPv6 地址]` 或 `[IPv6 地址]:port`。host 必须是合法的主机名，端口在 1 到 65535 之间，只能使用可打印的 ASCII 字符且不含空格，替换端口后总长不超过 259 个字符。
- 取值不合法或类型不对（例如布尔值）时返回 400，不创建 sandbox。
- 只能在创建时设置。它不影响出网策略，也不作用于 envd 的 49983 端口。

转发行为的完整说明见[应用端口与桌面](/integrate/e2b/ports)。

### 应用端口的公开访问 {#public-traffic}

与 E2B 一样，应用端口默认公开：

- 请求没有 `network` 字段，或 `network` 里没有 `allowPublicTraffic`（例如只设置了出网相关的字段），应用端口公开，任何知道地址的人都能访问。
- 只有显式写出 `allowPublicTraffic: false`，访问应用端口才需要携带 traffic token。

::: warning 注意
企业场景里，sandbox 中运行的服务通常不应该对公网开放。除非确实需要公开，创建时写上 `network: { allowPublicTraffic: false }`。这个选项只能在创建时设置。
:::

### metadata {#metadata}

metadata 是调用方自己的字符串键值对，随 sandbox 保存在 ctrl 中，查询与列表原样返回，列表可以按它筛选。

- metadata 对能经原生 API 读到这个 Workspace 的调用方可见，不是秘密。不要在里面放 token、密钥或由它们推出的值。
- metadata 与网关保存的其他信息一起受下表的合计上限约束，超出任一上限时创建返回 400，不创建 sandbox：

| 上限 | 值 | 计入 |
|---|---:|---|
| annotations 合计 | 262144 字节 | metadata 的 JSON 原文，加上 `maskRequestHost` 等网关保存的其他内容 |
| labels 合计 | 65536 字节 | 每个 metadata 条目一项，加上网关保存的其他 labels。key 与 value 符合 label 的命名规则时按原文计，否则按 48 个字符的摘要计 |

label 的命名规则见 [labels 与 annotations](/integrate/native-api/workspaces#labels-annotations)。key 用不超过 63 个字符的字母、数字与 `-`、`_`、`.` 时占用最少。

## 查询与列表 {#inspect-and-list}

### 查询单个 sandbox {#inspect}

`GET /sandboxes/{id}`，SDK 的 `sandbox.getInfo()` 或 `Sandbox.getInfo(id, config)`：

```javascript
const info = await sandbox.getInfo();
console.log(info.state, info.endAt, info.cpuCount, info.memoryMB, info.metadata);
```

响应包括创建响应的全部字段，以及：

| 字段 | 说明 |
|---|---|
| `state` | `running` 或 `paused`，见下表 |
| `startedAt` | 创建时间，精确到秒。恢复不改变它 |
| `endAt` | 运行中时是到期时间。暂停中的 sandbox 没有到期时间，这里是它最近一次状态变化的时间，通常就是暂停的时间 |
| `metadata` | 创建时的 metadata |
| `cpuCount`、`memoryMB`、`diskSizeMB` | 实际得到的资源，见[资源](#resources) |
| `allowInternetAccess`、`network`、`lifecycle`、`volumeMounts` | 实际生效的配置，见[字段回显](#echo) |

Kibotos 的 Workspace 状态与 E2B 状态的对应：

| Workspace | 查询结果 |
|---|---|
| 创建中、启动中、运行中 | `state: running` |
| 停止中、已停止 | `state: paused` |
| 启动时因可重试的原因没有调度成功（例如容量不足） | `state: paused`，见[容量不足时的恢复](/integrate/e2b/pause-resume#capacity) |
| 其他原因失败 | 502，消息以 `sandbox failed:` 开头，见[意外情况](/integrate/e2b/pause-resume) |
| 删除中、已删除，或不存在 | 404 |

sandbox 的 Volume 已被删除、处于不可用状态，或出站代理的配置已不存在时，查询返回 500，消息以 `inspect sandbox options:` 开头。这时 sandbox 仍然存在，不要把 500 当作 sandbox 已被删除。

### 列出 sandbox {#list}

`GET /v2/sandboxes`，SDK 的 `Sandbox.list()`。SDK 返回分页器，用 `hasNext` 与 `nextItems()` 逐页读取：

```javascript
const paginator = Sandbox.list({
  ...config,
  limit: 100,
  query: { metadata: { tenant: 'acme' }, state: ['running', 'paused'] },
});
while (paginator.hasNext) {
  for (const item of await paginator.nextItems()) {
    console.log(item.sandboxId, item.state, item.metadata);
  }
}
```

查询参数：

| 参数 | 说明 |
|---|---|
| `state` | `running`、`paused`，多个用逗号分隔。缺省时两种都列出 |
| `metadata` | 按 metadata 精确匹配，所有条件同时满足才列出 |
| `template` | 按 Template ID 精确匹配 |
| `startedAfter` | RFC 3339 时间，只列出创建时间不早于它的 sandbox |
| `order` | `asc` 或 `desc`，按创建时间排序，默认 `desc`，即最新创建的在前 |
| `limit` | 每页条数，1 到 100，默认 100 |
| `nextToken` | 上一页响应头 `X-Next-Token` 的值 |

用 REST 按 metadata 列出运行中的 sandbox：

```bash
curl -sS -G "$E2B_API_URL/v2/sandboxes" \
  -H "X-API-Key: $(cat "$E2B_API_KEY_FILE")" \
  --data-urlencode 'metadata=tenant=acme' \
  --data-urlencode 'state=running' \
  --data-urlencode 'limit=50' \
  -D -
```

- `metadata` 的值本身是 `key=value&key=value` 形式的查询串。key 或 value 含有 `&`、`=`、`%` 等特殊字符时，先对它们各做一次 URL 编码再拼接，SDK 会自动这样做。
- 响应头 `X-Next-Token` 出现时表示还有下一页。`X-Total-Running` 在查询包含 `running` 时出现，是符合筛选条件的运行中 sandbox 总数，不受分页影响。
- `nextToken` 与取得它的那次查询绑定。换了筛选条件、排序或伪造的 token 返回 400。分页可以在任意网关实例上继续；平台运营方更换 API key 之后，旧的 `nextToken` 失效。
- 列表不列出失败与已删除的 sandbox。
- sandbox 的 Volume 处于过渡状态时，列表照常列出这个 sandbox，它的 `volumeMounts` 为空数组。

### 字段回显 {#echo}

查询与列表返回实际生效的配置：

| 字段 | 回显规则 |
|---|---|
| `allowInternetAccess` | 当前期望的出网开关。只有创建请求显式带了这个字段，或者之后成功修改过网络，才会回显。SDK 创建时总是发送它；直接调用 REST 且省略它时不回显 |
| `network.allowOut`、`network.denyOut` | 最近一次设置出网策略的请求里的原值，没有条目时不回显。策略之后在网关之外被修改过时，回显原生策略里的条目 |
| `network.egressProxy` | 当前出站代理的 `address` 与 `username`，不含口令。没有代理时不回显 |
| `network.allowPublicTraffic` | 创建时的值 |
| `network.maskRequestHost` | 创建时的值，为空时不回显 |
| `volumeMounts` | 挂载的独立 Volume 的名称与路径，例如 `[{"name":"agent-ws","path":"/data"}]`。没有挂载独立 Volume 时为空数组 |
| `lifecycle` | 到期删除时为 `{"onTimeout":"kill","autoResume":false}`，到期暂停时 `onTimeout` 为 `pause`。暂停中的 sandbox 回显的是下次恢复后使用的设置 |

SDK 2.46.1 的 `getInfo()` 保留这些字段。SDK 的列表只保留 `volumeMounts`，`allowInternetAccess`、`network` 与 `lifecycle` 要通过 `getInfo()` 读取。

## 删除 {#delete}

`DELETE /sandboxes/{id}`，SDK 的 `sandbox.kill()` 或 `Sandbox.kill(id, config)`：

```javascript
await sandbox.kill();                                  // 删除成功返回 true
console.log(await Sandbox.kill(sandbox.sandboxId, config)); // 已经不存在，返回 false
```

- 网关确认删除完成后返回 204，最长等待约 90 秒。sandbox 不存在、已删除或正在被删除（例如另一个请求或到期动作已经开始删除）时返回 404。
- 运行中、暂停中与失败的 sandbox 都可以删除。
- 删除同时删除 sandbox 自带的 `/data` Volume，以及为出站代理保存的配置。挂载的独立 Volume 保留，需要时显式删除，见 [Volume](/integrate/e2b/volumes)。
- 删除后 `isRunning()` 返回 `false`，查询返回 404，SDK 抛出 `SandboxNotFoundError`。sandbox 指标在保留期内仍可查询。

## 到期时间 {#expiration}

每个运行中的 sandbox 都有到期时间。到期动作由 Kibotos 的 ctrl 执行：

- 到期动作为删除（`onTimeout: 'kill'`）时，sandbox 连同 `/data` Volume 被删除，独立 Volume 保留。
- 到期动作为暂停（`onTimeout: 'pause'`）时，sandbox 进入暂停，之后可以恢复。
- 暂停中的 sandbox 没有到期时间，会一直保留到你删除它，期间仍占用存储容量。

### 设置与延长 {#set-timeout}

四个请求会设置到期时间：

| 请求 | SDK | 规则 |
|---|---|---|
| `POST /sandboxes` 的 `timeout` | `Sandbox.create()` 的 `timeoutMs` | 按请求值设置。省略时用部署的默认值（默认 1 小时） |
| `POST /sandboxes/{id}/connect` 的 `timeout` | `Sandbox.connect()` 的 `timeoutMs` | 只延长：新的到期时间取现有到期时间与「当前时间 + timeout」中较晚的那个 |
| `POST /sandboxes/{id}/timeout` 的 `timeout` | `sandbox.setTimeout(ms)` | 按请求值设置，可以延长也可以缩短 |
| `POST /sandboxes/{id}/refreshes` 的 `duration` | 无 | 只延长，请求值不足 15 秒时按 15 秒处理 |

```javascript
await sandbox.setTimeout(60 * 60_000);   // 从现在起 1 小时后到期
const again = await Sandbox.connect(sandbox.sandboxId, { ...config, timeoutMs: 5_000 });
// 剩余时间比 5 秒长，connect 不缩短到期时间
console.log((await again.getInfo()).endAt);
```

```bash
curl -sS -X POST "$E2B_API_URL/sandboxes/$sandbox_id/timeout" \
  -H "X-API-Key: $(cat "$E2B_API_KEY_FILE")" \
  -H 'Content-Type: application/json' \
  --data '{"timeout":3600}'
```

上例中的 `sandbox_id` 是创建响应里的 `sandboxID`。

### 规则 {#expiration-rules}

- **取值。** `timeout` 的正整数是秒数。`0` 与负数都表示立即到期，网关设置 1 秒的有效期。
- **必填字段。** `connect` 与 `timeout` 的请求字段在 E2B 中是必填的，缺失时按 `0` 处理，只有创建可以省略。直接调用 REST 时，`POST /sandboxes/{id}/timeout` 发送 `{}` 会让 sandbox 立即到期；恢复暂停中的 sandbox 时不带 `timeout`，恢复后的 sandbox 也会立即到期。`refreshes` 的 `duration` 可以省略，按 15 秒处理。
- **只对运行中的 sandbox。** `timeout` 与 `refreshes` 只接受运行中的 sandbox，其他状态返回 409。修改暂停中 sandbox 的到期时间，用 `connect` 恢复时设置。
- **最长有效期。** 部署可以限制单次请求的有效期，取决于部署配置。`create` 与 `connect` 超过上限时返回 400，消息说明上限；`timeout` 与 `refreshes` 不做这项检查，与 E2B 相同。
- **从哪里开始计时。** 有效期从 ctrl 接受命令时开始计算，创建与启动的耗时都算在其中。
- **不影响有效期的操作。** 执行命令、读写文件与访问应用端口都不延长到期时间。修改出网策略同样不改变到期时间。
- **返回时机。** 这些请求在到期时间写入 ctrl 之后才返回成功。查询与列表的 `endAt` 直接来自 ctrl 保存的到期时间。
- **可靠性。** 网关本身停止不影响已设置的到期时间。ctrl 暂时不可用时延长请求会失败；ctrl 恢复后按已保存的时间执行到期动作。
- **不能撤回。** ctrl 已经开始执行到期动作后，延长请求不能再取消它。

## 幂等 {#idempotency}

网络中断或超时后，调用方不知道请求是否已经生效。下列请求接受 `Idempotency-Key` 请求头，用同一个 key 重试可以拿到第一次请求的结果，而不会重复执行：

- 创建、`connect`、暂停、`timeout`、`refreshes`、修改网络（`PUT /sandboxes/{id}/network`）与删除。

规则：

- key 最长 256 字节，超出返回 400。为每个逻辑操作生成一个新 key，例如 UUID，重试时原样复用。
- 同一个 key 的请求内容必须相同。换了请求内容时返回 409。
- 重试时，网关先向 ctrl 查询这条命令是否已经提交：已提交就等它完成并返回结果，未提交才重新发起。换一个网关实例重试同样成立。
- key 按部署、操作与 sandbox 区分，同一个 key 用在不同的操作上互不影响。它不是 Kibotos 原生 API 的幂等键（command ID），不能拿它到原生 API 查询命令。
- 部署配置在两次请求之间变化时，同一个 key 的创建重试也可能返回 409。
- 状态已被别的请求改变（版本冲突）时返回 409。网关不会读取新状态后重试旧请求，调用方读取当前状态后再决定下一步。

带 key 创建 sandbox。key 只生成一次并保存下来，结果不明时用同一个 `$key` 再发送一次相同的请求：

```bash
key="create-$(uuidgen)"   # 只生成一次，重试时复用
curl -sS -X POST "$E2B_API_URL/sandboxes" \
  -H "X-API-Key: $(cat "$E2B_API_KEY_FILE")" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $key" \
  --data '{"templateID":"kibotos-minimal","timeout":1800,"metadata":{"task":"report-20261106"}}'
```

Kibotos 原生 API 的幂等规则见[幂等键](/integrate/native-api/conventions#idempotency)。

## 相关文档 {#related}

- [暂停与恢复](/integrate/e2b/pause-resume)
- [出网策略与出站代理](/integrate/e2b/network)
- [Volume](/integrate/e2b/volumes)
- [与 E2B 的差异](/integrate/e2b/differences)
- [限制与默认值](/reference/limits)
