---
title: Volume 与 Transfer
description: 用 VolumeService 管理 Volume（状态、创建、扩容、删除、存储池、LOST、命令查询），用 TransferService 把一个 Workspace 的 Volume 导出、导入并恢复成新的 Workspace。
---

# Volume 与 Transfer

本页说明 `kibotos.ctrl.v1.VolumeService` 与 `TransferService`：Volume 是 Workspace 承诺保留数据的地方，Transfer 把一个已停止 Workspace 的 Volume 复制成新的 Volume，再用它恢复出新的 Workspace。读者是用原生 API 管理持久数据的集成开发者。

## 概述 {#overview}

- Volume 是独立于 Workspace 的持久块存储，挂在 Workspace 的挂载路径上（默认 `/data`），跨停止与启动保留。一个 Volume 同时至多被一个未删除的 Workspace 绑定。
- Volume 可以随 Workspace 创建（`WORKSPACE_VOLUME_MODE_NEW`），也可以先用 `CreateVolume` 建好再绑定。怎样绑定、换绑与解绑见 [Workspace](/integrate/native-api/workspaces#volume-binding)。
- Volume 从创建起占用存储池容量，直到删除。

## Volume 的状态 {#volume-states}

| 状态 | 含义 |
|---|---|
| `VOLUME_STATE_CREATING` | 正在创建。导入中的 Volume 也处于这个状态 |
| `VOLUME_STATE_AVAILABLE` | 可用，没有挂载在运行中的 Workspace 上 |
| `VOLUME_STATE_ATTACHED` | 挂载在运行中的 Workspace 上 |
| `VOLUME_STATE_RESIZING` | 正在扩容。这期间不接受挂载与新的绑定 |
| `VOLUME_STATE_DELETING` | 正在删除 |
| `VOLUME_STATE_DELETED` | 已删除。仍可读取，列表默认不返回 |
| `VOLUME_STATE_FAILED` | 最近一次命令失败，`failure` 给出 `reason`、`stage`、`retryable` 与 `message` |
| `VOLUME_STATE_UNKNOWN` | 最近一次命令的结果无法确认 |
| `VOLUME_STATE_LOST` <Badge type="tip" text="v0.3.0 新增" /> | 平台运营方宣告了它所在的存储池丢失，数据已经不存在，见 [LOST](#lost) |

`Volume` 的其他字段：

| 字段 | 含义 |
|---|---|
| `volume_id` | Volume ID |
| `spec.capacity_bytes` | 实际容量，总是非 0 |
| `spec.storage_pool` | 所在的存储池，见[存储池](#storage-pool) |
| `bound_workspace_id` | 绑定它的未删除 Workspace；空表示没有被绑定 |
| `labels`、`annotations` 及其 `*_revision` | 调用方自己的数据，规则同 Workspace，见 [labels 与 annotations](/integrate/native-api/workspaces#labels-annotations) |
| `observation` | 持有它的 node 最近一次报告的数据状况，见下文 |
| `created_at`、`updated_at` | 时间 |

`observation` 是诊断信息，不是状态：`condition` 为 `VOLUME_CONDITION_HEALTHY` 或 `VOLUME_CONDITION_DAMAGED`，`DAMAGED` 表示持有它的 node 无法把它当作原来创建的 Volume 打开，`reason` 与 `message` 说明原因。状态只由命令改变，准入也不看观测；没有 node 持有它时观测保持原样，用 `observed_at` 判断新旧。只有 `GetVolume` 与 `ListVolumes` 返回它，命令的响应不带。

## 创建 {#create-volume}

`CreateVolume` 的请求字段：

| 字段 | 说明 |
|---|---|
| `metadata.command_id` | 幂等键，见[幂等键](/integrate/native-api/conventions#idempotency) |
| `spec` | 必填，可以是空对象 |
| `spec.capacity_bytes` | 容量。0 表示由部署的存储配置决定 |
| `spec.storage_pool` | 存储池名。留空使用部署的默认池，需要能力名 `volume.storage_pool` |
| `labels`、`annotations` | 与创建命令在同一个事务里写入，参与幂等比较 |

- 创建在请求内完成，响应带回结果状态，以及实际的容量与存储池。
- 存储池容量不足时返回可重试的 `resource_exhausted`。
- 新建的 Volume 不属于任何 Workspace。用 `CreateWorkspace` 的 `WORKSPACE_VOLUME_MODE_BOUND` 或 `UpdateWorkspaceVolumeBinding` 绑定；默认 `delete_with_workspace` 关闭，删除 Workspace 时只解除绑定。

## 扩容 {#resize-volume}

`ResizeVolume` 的字段是 `metadata.command_id`、`volume_id` 与 `capacity_bytes`：

- `capacity_bytes` 是扩容后的总容量，不是增量，必填，只能增大。等于当前容量时直接成功、不做任何事；小于当前容量时返回 `invalid_argument`。
- 只扩容没有挂载在任何地方的 Volume。Volume 仍挂载着，或绑定它的 Workspace 仍持有执行时，返回 `failed_precondition`，先停止 Workspace。
- 扩容期间 Volume 处于 `RESIZING`。node 同时扩大 Volume 里的文件系统，Workspace 再次启动后 guest 即可使用新容量。
- 扩容在请求内完成，扩展文件系统可能需要几分钟，客户端超时要设得足够长。结果未知时用 `GetVolumeCommand` 查询，或用原幂等键重发。
- 没有版本校验，只有幂等键与目标容量。存储池容量不足时返回可重试的 `resource_exhausted`。

## 删除 {#delete-volume}

`DeleteVolume` 的字段是 `metadata.command_id` 与 `volume_id`：

- 绑定在未删除的 Workspace 上的 Volume 不能删除，返回 `failed_precondition`（`reason` 为 `CONFLICT`），错误详情带 `observed_volume` 与 `observed_workspace`。先解除绑定，或删除那个 Workspace。
- `FAILED`、`UNKNOWN` 与 `LOST` 的 Volume 都可以删除；删除取代正在处理的其他命令。
- 存储池暂时没有可用的 node 时，删除照样立即完成，块文件等存储池有 node 可用后再删除。
- 删除后数据不可恢复。已删除的 Volume 仍可以用 `GetVolume` 读取，`labels` 与 `annotations` 也保留。
- 随 Workspace 删除的 Volume 不需要单独删除，由 `DeleteWorkspace` 按绑定的 `delete_with_workspace` 处理。

## 存储池 {#storage-pool}

`spec.storage_pool` 是 Volume 所在的存储池。Volume 在哪里，决定了绑定它的 Workspace 能在哪些 node 上运行。

- 创建时留空使用部署的默认池；返回的 Volume 总是给出实际的池名。部署有哪些存储池由平台运营方决定。
- 平台运营方可以把 Volume 搬到另一个存储池，`storage_pool` 随之改变。每次需要时都从 Volume 读取，不要自己缓存。
- 搬迁期间，启动绑定它的 Workspace、扩容、绑定或解绑、删除与导出都返回可重试的 `unavailable`，搬迁结束后用原幂等键重试。

## 列表 {#list-volumes}

`ListVolumes` 的字段是 `page_size`、`page_token`、`include_deleted` 与 `label_selector`：

- 默认不返回已删除的 Volume，`include_deleted` 为真时一并返回。
- `label_selector` 要求每一项的 key 存在且值完全相等；翻页时必须与第一页相同。
- 分页规则见[调用约定](/integrate/native-api/conventions)。

## LOST {#lost}

`VOLUME_STATE_LOST` 只在平台运营方宣告存储池丢失之后出现，表示这个 Volume 的数据已经不存在，也不会被替换成一个空 Volume。

- 能读取与删除，其他操作都返回 `failed_precondition`。
- 绑定它的 Workspace 启动时返回 `failed_precondition`，`reason` 为 `VOLUME_LOST`，不可重试。用 `UpdateWorkspaceVolumeBinding` 改绑另一个 Volume，或删除这个 Workspace。
- 服务端支持这个状态时宣告能力名 `volume.lost`。

## 查询命令结果 {#volume-command}

`GetVolumeCommand` 按 `volume_id` 与 `command_id` 返回一条 Volume 命令的记录：`status`（`VOLUME_COMMAND_STATUS_PROCESSING` 或 `VOLUME_COMMAND_STATUS_COMPLETED`）、`error_code`、`error`、`method`，以及历史结果 `result`（`create`、`delete`、`resize`、`labels`、`annotations` 之一）。判断方法与 `GetWorkspaceCommand` 相同，见[调用约定](/integrate/native-api/conventions)。

## Transfer {#transfer}

Transfer 把一个已停止的 Workspace 的 Volume 内容复制成新的 Volume，再用它创建新的 Workspace，分三步：

1. `ExportWorkspace`：把源 Workspace 的 Volume 打包成归档，Transfer 变为 `COMPLETE`。
2. `ImportTransfer`：用归档建出一个新的 Volume，Transfer 变为 `IMPORTED`。
3. `RestoreWorkspace`：用这个 Volume 和你给出的规格创建新的 Workspace，Transfer 变为 `RESTORED`。

每一步在 ctrl 接受之后由 ctrl 自己执行到底，ctrl 重启或 node 短暂不可达时自行重试。只复制 Volume 的内容：根文件系统的可写层、内存与进程都不在其中。

### Transfer 的状态 {#transfer-states}

| 状态 | 含义 |
|---|---|
| `TRANSFER_STATE_EXPORTING` | 正在导出 |
| `TRANSFER_STATE_COMPLETE` | 导出完成，可以导入 |
| `TRANSFER_STATE_IMPORTING` | 正在导入 |
| `TRANSFER_STATE_IMPORTED` | 导入完成，可以恢复 |
| `TRANSFER_STATE_RESTORING` | 正在恢复 |
| `TRANSFER_STATE_RESTORED` | 恢复完成 |
| `TRANSFER_STATE_EXPIRED` | 归档超过保留期还没有导入，不能再导入 |
| `TRANSFER_STATE_DELETING`、`TRANSFER_STATE_DELETED` | 正在删除、已删除 |
| `TRANSFER_STATE_FAILED` | 失败，`failure` 说明原因 |
| `TRANSFER_STATE_UNKNOWN` | 结果无法确认 |

`Transfer` 还带 `imported_volume_id`、`restored_workspace_id`、`reestablish_required`、`completeness` 与时间字段。

### 导出 {#export}

`ExportWorkspace` 的字段是 `metadata.command_id` 与 `workspace_id`：

- 源 Workspace 必须处于 `STOPPED` 并绑定了 Volume；没有 Volume 时返回 `failed_precondition`。
- 导出期间源 Workspace 被锁定：`DeleteWorkspace` 返回可重试的 `unavailable`，`StartWorkspace` 等导出结束后才执行。源 Workspace 在导出被受理之后又启动过或换了 Volume 时，导出以 `failed_precondition` 失败，重新停止后换一个幂等键再导出。
- Volume 根目录下的 `.kibotos/credentials` 与 `.kibotos/browser-state` 两个目录不会被导出。挂载在 `/data` 时，就是 `/data/.kibotos/credentials` 与 `/data/.kibotos/browser-state`。
- 归档大小有上限，超出时导出失败，返回 `resource_exhausted`，见[保留期与大小上限](#retention)。
- 最多等 1 分钟，超时返回可重试的 `unavailable`，错误详情的 `observed_transfer` 带当前的 Transfer；用原幂等键重发，或用 `GetTransfer` 查询。大的 Volume 导出可能需要几分钟。

导出完成后 `manifest` 描述归档：

| 字段 | 含义 |
|---|---|
| `source_workspace_id`、`source_workspace_generation`、`source_volume_id` | 来源 |
| `included_paths`、`excluded_paths` | 包含与排除的路径 |
| `regular_file_count`、`directory_count`、`symlink_count` | 文件、目录与符号链接的数量 |
| `logical_bytes`、`archive_bytes`、`archive_sha256` | 内容字节数、归档字节数与归档的 SHA-256 |
| `created_at`、`expires_at` | 归档的创建时间与过期时间 |
| `format_revision`、`producer_revision`、`completeness` | 格式与完整性信息 |

### 导入 {#import}

`ImportTransfer` 的字段是 `metadata.command_id`、`transfer_id` 与可选的 `storage_pool`：

- 只有 `COMPLETE` 的 Transfer 可以导入。`EXPIRED` 的返回 `failed_precondition`，需要重新导出。
- 导入创建一个新的 Volume，响应带回 `transfer` 与 `volume`。导入期间这个 Volume 可以读到，状态为 `CREATING`。
- `storage_pool` 留空时，新 Volume 放在被导出 Volume 当时所在的存储池；给出时放在指定的池，需要能力名 `transfer.import.storage_pool`。由哪台 node 执行导入由部署决定。
- 因为没有可用的 node 或存储池容量不足而失败时，返回可重试的 `unavailable` 或 `resource_exhausted`，Transfer 回到 `COMPLETE`，稍后换一个幂等键再导入。
- 在 node 上失败的导入让 Transfer 进入 `FAILED`，错误不可重试，需要重新导出。
- 最多等 1 分钟，超时的处理同导出。

### 恢复 {#restore}

`RestoreWorkspace` 的字段：

| 字段 | 说明 |
|---|---|
| `metadata.command_id` | 幂等键 |
| `transfer_id` | 处于 `IMPORTED` 的 Transfer |
| `spec` | 新 Workspace 的 `WorkspaceCreateSpec`，规则与 `CreateWorkspace` 相同。`spec.volume` 必须是 `WORKSPACE_VOLUME_MODE_BOUND`，并指向导入得到的 Volume |
| `expiration` | 可选，与 `CreateWorkspace` 的到期设置相同，在版本 1 提交 |

- 恢复不会换用别的 Volume，也不会改动源 Workspace。
- 恢复中的 Workspace 可以用 `GetWorkspace` 读到，状态为 `CREATING`。最多等 1 分钟，超时的处理同导出。
- 成功后 Transfer 为 `RESTORED`，`restored_workspace_id` 是新的 Workspace。
- `reestablish_required` 列出需要重新建立的东西：`REESTABLISH_REQUIREMENT_DATA_PLANE_SESSION`（会话凭证）、`REESTABLISH_REQUIREMENT_CREDENTIAL`（凭证）、`REESTABLISH_REQUIREMENT_PROCESS`（进程）与 `REESTABLISH_REQUIREMENT_LOGIN_STATE`（登录状态）。新 Workspace 里没有原来的进程，会话凭证要重新申请，凭证与登录状态也要重新建立。
- 恢复失败、且新 Workspace 不持有执行时，导入的 Volume 被释放，Transfer 回到 `IMPORTED`，可以换一个幂等键再恢复。
- 恢复失败但仍持有执行，或结果未知时，Volume 保持绑定，Transfer 保持 `RESTORING`：删除那个 Workspace 后 Transfer 回到 `IMPORTED`，Volume 随 Workspace 删除时 Transfer 变为 `FAILED`；之后对那个 Workspace 成功执行 `StartWorkspace` 时 Transfer 变为 `RESTORED`。

### 删除 Transfer {#delete-transfer}

`DeleteTransfer` 的字段是 `metadata.command_id` 与 `transfer_id`：

- 立即删除归档，不需要任何 node 在线。
- 导出、导入或恢复还在进行时返回 `failed_precondition`。
- 已经导入得到的 Volume 与恢复出的 Workspace 不受影响。

### 保留期与大小上限 {#retention}

归档存放在部署的存储里，保留期与大小上限都是部署配置，可向平台运营方确认：

| 项 | 默认值 |
|---|---|
| 归档保留期 | 24 小时，从导出完成时算起 |
| 单个归档的大小上限 | 1 GiB |

- 过了保留期还没有导入的 Transfer 变为 `EXPIRED`，之后不能再导入，需要重新导出。
- 已经导入或恢复的 Transfer 不受过期影响，导入得到的 Volume 与恢复出的 Workspace 照常使用。

## 相关文档 {#related}

- [Workspace](/integrate/native-api/workspaces)：创建时的 Volume 绑定、换绑与解绑。
- [调用约定](/integrate/native-api/conventions)：幂等键、命令查询与分页。
- [数据持久性与保护](/security/data)：哪些数据跨停止与启动保留。
- [Volume 与数据迁移](/integrate/kibo/storage)：用 `kibo` 完成同样的操作。
