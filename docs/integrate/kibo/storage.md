---
title: Volume 与数据迁移
description: 用 kibo 创建、查看、扩容与删除 Volume，以及用 Transfer 把一个已停止 Workspace 的 Volume 导出、导入成新的 Volume 并恢复出新的 Workspace。
---

# Volume 与数据迁移

本页说明怎样用 `kibo` 管理 Volume，以及怎样用 Transfer 把一个 Workspace 的数据复制到新的 Volume 和新的 Workspace。读者是需要持久数据或迁移数据的接入开发者。Workspace 怎样绑定、换绑与解绑 Volume 见[管理 Workspace](/integrate/kibo/workspaces)。

## 概述 {#overview}

- **Volume** 是独立于 Workspace 的持久块存储，里面是一个 ext4 文件系统。一个 Volume 同时至多绑定一个 Workspace，挂在它的一个路径上，默认 `/data`。只有 Volume 的挂载路径承诺在停止、启动之间保留数据。
- 每个 Workspace 默认带一个随它新建、随它删除的 Volume。独立的 Volume 用 `kibo volume create` 创建，或由 `kibo transfer import` 导入得到，删除绑定它的 Workspace 时默认只解除绑定。
- **Transfer** 把一个已停止 Workspace 的 Volume 内容打包成归档，再导入成一个新的 Volume，并用它创建新的 Workspace。它复制的是文件，不是快照：会话、凭证、进程与登录状态都要重新建立。

Volume 与 Transfer 的接口语义见 [Volume 与 Transfer](/integrate/native-api/volumes-transfers)，数据保留的边界见[数据持久性与保护](/security/data)。

## Volume {#volumes}

### 创建 {#volume-create}

```bash
volume_id=$(kibo volume create --capacity 10G -q)
kibo workspace create --template "$template_id" --volume "$volume_id"
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--capacity` | 由部署的存储配置决定 | 容量，写法与 `--memory` 相同，如 `10G`、`512MiB`。非正数、十进制单位或无法解析时在发请求前被拒绝，退出码 `2` |
| `--storage-pool` | 部署的默认存储池 | Volume 放在哪个存储池。Volume 在哪里，决定了绑定它的 Workspace 能在哪些 node 上运行。可用的池名向平台运营方确认。需要服务端宣告 `volume.storage_pool` |
| `--label`、`--annotation` | 无 | 调用方自己的键值数据，规则见[管理 Workspace](/integrate/kibo/workspaces) |
| `--command-id` | 自动生成 | 幂等键，输出的 `command_id` 中返回实际使用的值 |

- 新建的 Volume 不属于任何 Workspace。之后用 `kibo workspace create --volume` 或 `kibo workspace volume bind` 绑定。
- 返回的 Volume 总是带着它实际得到的容量，包括由存储配置决定的情形。

### 查看与列出 {#volume-get-list}

```bash
kibo volume get "$volume_id"
kibo volume list
kibo volume list --include-deleted -l team=infra
```

- `get` 显示状态、`Capacity`（服务端没有返回容量时为 `unknown`）、`Storage pool`、`Bound to`（绑定它的 Workspace）、创建时间、labels 与 annotations，失败时另有 `Failure` 一节；`--wide` 另有 labels、annotations 的版本与更新时间。
- `list` 默认不显示已删除的 Volume，`--include-deleted` 显示全部。表格列是 `VOLUME`、`STATE`、`CAPACITY`、`POOL`、`BOUND WORKSPACE`；`-l`、`-L`、`--wide`、`--page-size`、`--page-token` 与 `--all` 的用法与 `kibo workspace list` 相同。

| 状态 | 含义 |
|---|---|
| `CREATING` | 正在创建 |
| `AVAILABLE` | 可用，可以绑定或扩容 |
| `ATTACHED` | 挂载在 node 上，供绑定它的 Workspace 使用 |
| `RESIZING` | 正在扩容，这期间不接受挂载与新的绑定 |
| `DELETING`、`DELETED` | 正在删除、已删除 |
| `FAILED` | 操作失败，`Failure` 一节说明原因 |
| `UNKNOWN` | ctrl 暂时无法确定 |
| `LOST` | 平台运营方宣告它所在的存储池丢失，数据已经不在。只能查看与删除，其他操作返回 `failed_precondition`；绑定它的 Workspace 在换绑到别的 Volume 或被删除之前无法启动 |

### 扩容 {#volume-resize}

```bash
kibo workspace stop "$workspace_id"
kibo volume resize "$volume_id" --capacity 20G
kibo workspace start "$workspace_id"
```

- `--capacity` 必填，是扩容后的总容量，只能增大。等于当前容量时命令成功但不做任何事；小于当前容量时返回 `invalid_argument`。
- 只有没有挂载在任何地方的 Volume 接受扩容。Volume 仍挂载在 node 上，或绑定它的 Workspace 正在运行、仍持有执行时，返回 `failed_precondition`（退出码 `13`），先停止那个 Workspace。
- 扩容期间 Volume 状态为 `RESIZING`。node 同时扩大其中的文件系统，Workspace 再次启动后 guest 即可使用新容量。

### 删除 {#volume-delete}

```bash
kibo volume delete "$volume_id"
```

- 命令先请求确认，删除后数据无法恢复；不在终端里运行时必须加 `--yes`。
- 绑定上标记为随 Workspace 删除的 Volume，在删除 Workspace 时一起删除，不需要单独删除。
- 存储池暂时没有可用的 node 时，删除照样立即完成，文件在之后有 node 可用时删除；对应 Workspace 的 `cleanup-status` 里，`VOLUME_DELETION` 在这期间为 `PENDING`。

### 查询命令结果 {#volume-command-get}

```bash
kibo --json volume command get "$volume_id" "$command_id"
```

按幂等键查询 `volume create`、`delete`、`resize` 的结果：`status`（`VOLUME_COMMAND_STATUS_PROCESSING` 或 `VOLUME_COMMAND_STATUS_COMPLETED`）、`error` 与对应的结果。写命令的响应丢失时用它确认，不要换一个幂等键重新提交。`volume create` 的响应丢失时还不知道 Volume ID，这时用同一个 `--command-id` 和同样的参数重跑 `kibo volume create`，得到的是原来那个 Volume。

### 存储池与搬迁 {#storage-pools}

每个 Volume 和每个 Workspace 的可写层都放在某个存储池里，Workspace 只能在同时访问得到这两者的 node 上运行。存储池由平台运营方管理，部署里有哪些池、各自对应哪些 node，向平台运营方确认。

平台运营方可以把 Volume 或可写层搬到另一个存储池。搬迁由平台运营方执行，本站不展开；搬迁期间，下面这些操作被服务端以可重试的 `unavailable` 拒绝，错误信息为 `a Volume or writable layer the request uses is moving to another storage pool; retry after the move settles`：

| 搬迁的对象 | 被拒绝的操作 |
|---|---|
| Volume | 启动所属或绑定它的 Workspace、扩容、绑定或解绑、删除、导出 |
| Workspace 的可写层 | 启动与删除这个 Workspace、调整可写层容量 |

这些都是写命令：`kibo` 遇到 `unavailable` 时不能确定服务端是否执行了操作，以退出码 `18` 结束，`--json` 输出的 `error.connect_code` 为 `unavailable`、`error.retryable` 为 `true`。搬迁结束后用同一个 `--command-id` 重试即可。

## Transfer {#transfer}

```mermaid
flowchart LR
  A["已停止的 Workspace 与它的 Volume"] -- "transfer export" --> B["Transfer 归档（COMPLETE）"]
  B -- "transfer import" --> C["新的 Volume"]
  C -- "transfer restore" --> D["新的 Workspace"]
```

Transfer 分三步，每一步在 ctrl 受理之后由 ctrl 自己执行到底，ctrl 重启或 node 短暂不可达时 ctrl 自行重试。

```bash
kibo workspace stop "$workspace_id"
transfer_id=$(kibo transfer export "$workspace_id" -q)
volume_id=$(kibo --json transfer import "$transfer_id" | jq -er '.result.volume.volume_id')
kibo transfer restore "$transfer_id" --volume "$volume_id" --template "$template_id" --memory 1G
```

### 导出 {#transfer-export}

- `export` 要求 Workspace 处于 `STOPPED` 且绑定了 Volume。node 把 Volume 里的文件打包成归档，上传到部署的对象存储，大的 Volume 要几分钟。
- 完成后 Transfer 为 `COMPLETE`。`kibo transfer get` 的 `Manifest` 一节给出来源 Workspace 与 Volume、包含与排除的路径、文件数、目录数、符号链接数、数据量、归档大小、归档的 SHA-256 与过期时间。
- 单个归档默认不超过 1 GiB，超出时导出失败。这个上限由部署配置决定，可向平台运营方确认。

### 不导出的目录 {#transfer-exclusions}

Volume 根目录下的 `.kibotos/credentials` 与 `.kibotos/browser-state` 两个目录不会被导出。Volume 挂在 `/data` 时，就是 `/data/.kibotos/credentials` 与 `/data/.kibotos/browser-state`。

::: warning 其他内容全部导出
除了这两个目录，Volume 里的其他内容都会进入归档，包括应用自己保存的凭证与浏览器数据，例如 `kibotos-memoh` 放在 `/data/.memoh/browser` 的浏览器 profile。导出前确认归档的去向与保管方式，见[数据持久性与保护](/security/data)。
:::

### 导入 {#transfer-import}

- `import` 创建一个新的 Volume。默认放在被导出 Volume 所在的存储池；`--storage-pool` 指定另一个池（需要服务端宣告 `transfer.import.storage_pool`）。由哪台 node 执行导入由部署决定，只要它访问得到目标池。
- `import` 没有 `-q`，导入得到的 Volume ID 在 JSON 输出的 `result.volume.volume_id`，Transfer 在 `result.transfer`。
- 因为没有可用的 node 或池容量不足而失败的导入不消耗 Transfer，它仍是 `COMPLETE`，稍后换一个命令 ID 再导入。在 node 上失败的导入让 Transfer 进入 `FAILED`，需要重新导出。

### 恢复 {#transfer-restore}

`restore` 用导入得到的 Volume 和你给出的规格创建新的 Workspace，并启动它：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--volume` | 必填 | `transfer import` 得到的 Volume |
| `--template` | 必填 | 新 Workspace 的 Template ID |
| `--template-revision` | Template 的默认 revision | 精确的 revision |
| `--mount-path` | `/data` | Volume 的挂载路径 |
| `--cpu`、`--memory`、`--disk`、`--capability` | 与 `workspace create` 相同 | 写法见[管理 Workspace](/integrate/kibo/workspaces#create) |
| `--expires-in`、`--expiration-action` | 不设到期 | 见[到期](/integrate/kibo/workspaces#expiration) |
| `--wait-timeout` | `1h` | 等待恢复完成的时间 |

- 恢复出的 Workspace 网络策略为 `deny-all`，需要访问网络时再用 `kibo workspace network set` 修改。`restore` 不接受 labels 与 annotations。
- 绑定的 Volume 在删除这个 Workspace 时默认保留。
- 会话、凭证、进程和登录状态需要重新建立，`kibo transfer get` 的 `Re-establish` 一行列出要重新建立的项。
- `restore` 没有 `-q`，新 Workspace 的 ID 在 JSON 输出的 `result.workspace.workspace_id`。

### 等待与重试 {#transfer-wait}

- `kibo` 提交后，在 ctrl 报告命令仍在执行或没有应答时，用同一个命令 ID 重发，直到命令完成或到 `--wait-timeout`：`export` 与 `import` 默认 2 小时，`restore` 默认 1 小时。
- 等待开始后，标准错误上有一行说明在等什么，例如 `Exporting Workspace ws-01k6… as Transfer xfer-01k6… (command kibo-…); waiting for the export to finish`。加 `--json` 或 `-q` 时不输出。
- 等待结束或按 Ctrl-C 不会撤回命令，退出码为 `16`，错误信息给出带 `--command-id` 的原命令：用原来的 `--command-id` 再运行同一条命令，接着等它的结果。
- 提交的结果无法确定时退出码为 `18`，同样用原来的 `--command-id` 重跑。

### 过期与删除 {#transfer-expiry}

- 归档在导出完成后默认保留 24 小时，这个时长由部署配置决定。过了保留时间还没有导入的 Transfer 变为 `EXPIRED`，之后 `import` 返回 `failed_precondition`，需要重新导出。
- 已经导入或恢复的 Transfer 不受过期影响，导入得到的 Volume 和恢复出的 Workspace 照常使用。
- `kibo transfer delete "$transfer_id"` 立即删除归档，不需要任何 node 在线。命令先请求确认，不在终端里运行时必须加 `--yes`。导出、导入或恢复还在进行时返回 `failed_precondition`（退出码 `13`）。

### Transfer 的状态 {#transfer-states}

`kibo transfer get "$transfer_id"` 显示状态、`Completeness`、创建与更新时间、`Imported volume`、`Restored workspace`、`Re-establish`，以及 `Manifest` 与失败时的 `Failure` 一节。

| 状态 | 含义 |
|---|---|
| `EXPORTING` | 正在导出 |
| `COMPLETE` | 导出完成，可以导入 |
| `IMPORTING`、`IMPORTED` | 正在导入、已导入成 Volume |
| `RESTORING`、`RESTORED` | 正在恢复、已恢复出 Workspace |
| `DELETING`、`DELETED` | 归档正在删除、已删除 |
| `FAILED` | 失败，`Failure` 一节说明阶段与原因 |
| `EXPIRED` | 归档已过保留期，不能再导入 |
| `UNKNOWN` | ctrl 暂时无法确定 |

## 下一步 {#next-steps}

- [管理 Workspace](/integrate/kibo/workspaces)
- [Volume 与 Transfer](/integrate/native-api/volumes-transfers)
- [数据持久性与保护](/security/data)
- [kibo 命令参考](/reference/kibo-cli#exit-codes)
