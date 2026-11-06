---
title: 调用约定
description: 原生 API 的通用约定：用能力名判断服务端支持什么、写操作的幂等键与返回时机、版本校验、错误格式、分页，以及兼容窗口。
---

# 调用约定

本页集中说明原生 API 所有服务共用的约定：调用前怎样确认服务端支持某个操作，写操作怎样做到可以安全重发，怎样避免覆盖别人的修改，以及错误与分页的格式。各服务页面只写与本页不同的地方。

## 能力协商 {#capabilities}

调用业务方法之前，先调用 `kibotos.ctrl.v1.ServerInfoService/GetServerInfo`。响应有两个字段：

| 字段 | 含义 |
|---|---|
| `source_revision` | 服务端构建自哪个源码版本，只用于展示 |
| `capabilities` | 服务端提供的能力名（capability）列表，例如 `workspace.create`、`workspace.filesystem`、`workspace.desktop` |

规则：

- **没有 API 版本号可比较。** 兼容性只看能力名，不要按 `source_revision` 或版本号分支。
- **按名字精确匹配。** 一个操作需要的能力名在列表里找不到时，只让这一个操作失败，其余功能照常使用，不要因此拒绝整个服务端。
- **写入新字段之前先确认。** 服务端忽略请求里不认识的字段，版本较旧的服务端会静默丢掉新字段而不报错。例如写 `labels` 之前确认 `workspace.labels`，写网络策略的 `allow`、`deny` 之前确认 `workspace.network_policy.destination_rules`。
- **能力列表会随部署升级变化。** 长期运行的程序在重新连接时重新读取一次。
- `kibo` 在每条命令之前做同样的精确匹配，缺少能力时以退出码 `14` 失败。

能力名按下面的规则取，以后新增的名字也一样：

- 资源操作写作 `<资源>.<动词>`，动词取自方法名：`CreateWorkspace` 是 `workspace.create`，`ResizeVolume` 是 `volume.resize`。
- 修改资源的一部分写作 `<资源>.<部分>.<动词>`：`UpdateWorkspaceCpu` 是 `workspace.cpu.update`，`ResizeWorkspaceWritableLayer` 是 `workspace.writable_layer.resize`。
- 已有操作后来增加的选项或字段写作 `<操作或资源>.<选项>`：`workspace.stop.force`、`volume.storage_pool`。
- node 数据面上的每个服务一个名字，写作 `workspace.<服务>`，例如 `workspace.process`。
- 多个词之间用下划线，与字段名一致。

完整清单与引入版本见[能力名清单](/reference/capabilities)。

## 幂等键 {#idempotency}

每个写请求都带一个调用方生成的幂等键（command ID）。服务端用它识别重发：网络中断、超时或结果未知时，用同一个幂等键原样重发，操作不会执行两次。

| 接口 | 字段位置 |
|---|---|
| Workspace API（`kibotos.ctrl.v1`） | 请求里的 `CommandMetadata metadata`，字段 `command_id` |
| Operator API（`kibotos.operator.v1`） | 请求里的 `string command_id` |

幂等键只出现在请求消息里，不是 HTTP 头。只读方法没有幂等键；Operator API 的 `RevokeEnrollment` 与 `RetainLaunchRevision` 也没有，它们的效果本身可以重复施加。

### 格式 {#command-id-format}

- 服务端要求幂等键非空，并保留三个前缀给自己发起的命令：`expiration/`（到期动作）、`host-memory/`（宿主内存耗尽后的强制停止）与 `guest-shutdown/`（guest 关机后的强制停止）。以这些前缀开头的幂等键返回 `invalid_argument`。
- 建议使用 `kibo` 接受的格式：匹配 `^[A-Za-z0-9][A-Za-z0-9._/-]*$`，长度 1 到 128 字节。这样同一个幂等键也能用于 `kibo` 的 `--command-id`。
- 幂等键是标识，不要在里面放凭证或用户数据。

### 重发的结果 {#replay}

- **相同的幂等键、相同的输入**：返回第一次的结果，不会重复执行。第一次还在执行时，重发会等待它或报告它仍在执行。
- **相同的幂等键、不同的输入**：返回 `already_exists`，`ErrorDetail.reason` 为 `CONFLICT`。同一个幂等键用在另一个对象或另一种方法上也算不同的输入。
- `CreateWorkspace` 与 `UpdateWorkspaceNetworkPolicy` 比较输入时不看 `network_policy.revision`：这个值由服务端分配，请求里填什么都被忽略。
- `CreateWorkspace`、`CreateVolume`、`CreateEgress`、`CreateResolver` 的 `labels` 与 `annotations` 参与比较。
- `UpdateWorkspaceMemory`、`UpdateWorkspaceCpu` 与 `UpdateWorkspaceVolumeBinding` 被拒绝时不留下命令记录：`GetWorkspaceCommand` 对这个幂等键返回 `not_found`，用它重发会按当时的状态重新判断。
- `CreateDataPlaneSession` 的重发返回同一张会话凭证；那张凭证过期之后再用同一个幂等键，返回 `failed_precondition`（`SESSION_EXPIRED`），需要换一个新的幂等键。

使用方法：

1. 每个新操作生成一个新的幂等键，在发送之前保存下来。
2. 超时、断线或收到可重试的错误时，用同一个幂等键和完全相同的请求重发。
3. 只有确定要发起一个新的操作时才换新的幂等键。查不到命令记录不代表请求失败，不要因此换新键重发。

### 返回时机与结果查询 {#command-results}

命令什么时候返回取决于命令本身：

| 命令 | 返回时机 | 结果怎么查 |
|---|---|---|
| `CreateWorkspace`、`StartWorkspace` | 受理即返回，Workspace 处于 `CREATING` 或 `STARTING`，服务端继续执行 | `GetWorkspaceCommand` |
| `StopWorkspace`、`DeleteWorkspace`、`RevokeWorkspaceDataPlane` | 等命令完成，最长 1 分钟 | 超时返回可重试的 `unavailable`，命令继续执行；用 `GetWorkspaceCommand` 查，或用原幂等键重发 |
| `ExportWorkspace`、`ImportTransfer`、`RestoreWorkspace` | 等命令完成，最长 1 分钟 | 超时同上，错误详情的 `observed_transfer` 带当前的 Transfer；用它的 `transfer_id` 调 `GetTransfer`，或用原幂等键重发 |
| `CreateVolume`、`DeleteVolume` | 在请求内完成，响应带回结果状态 | 结果未知时用 `GetVolumeCommand` |
| `ResizeVolume`、`ResizeWorkspaceWritableLayer` | 在请求内完成，扩容文件系统可能需要几分钟 | 结果未知时，Volume 用 `GetVolumeCommand`，可写层用 `GetWorkspaceCommand` |
| 其余写操作（配置、labels、Egress、Resolver、Exposure 等） | 在请求内完成 | 结果未知时用原幂等键重发 |

`GetWorkspaceCommand`（参数 `workspace_id`、`command_id`）与 `GetVolumeCommand`（参数 `volume_id`、`command_id`）返回一条命令的持久记录：

| 字段 | 含义 |
|---|---|
| `status` | `PROCESSING`：仍在执行；`COMPLETED`：已经结束。完整的枚举名是 `WORKSPACE_COMMAND_STATUS_*` 或 `VOLUME_COMMAND_STATUS_*` |
| `error_code` | Connect 错误码的数值。`PROCESSING` 时为 0 不代表成功 |
| `error` | `ErrorDetail`，命令失败或执行中遇到错误时出现 |
| `result` | 命令完成时的响应，是历史结果，不是对象的当前状态 |
| `method`、`created_at`、`updated_at` | 方法名与时间 |

按下面的顺序判断：

1. `status` 为 `COMPLETED` 且没有 `error`：命令成功，结果在 `result`。
2. `status` 为 `COMPLETED` 且有 `error`：命令失败，`error_code` 与 `error` 说明原因。
3. `status` 为 `PROCESSING`：仍在执行。带有 `retryable` 为 `true` 的 `error` 时，表示这次尝试遇到了暂时的问题，服务端还会继续；`retryable` 为 `false` 时，表示服务端已经用完执行时限、结果无法确定，按[强制停止](/integrate/native-api/workspaces#force-stop)或删除处理这个 Workspace。

`GetWorkspaceCommand` 只返回属于这个 Workspace 的命令，幂等键属于其他 Workspace 时返回 `not_found`。

## 版本校验 {#expected-revision}

修改已有对象的请求带一个期望版本（expected revision）。对象的当前版本与期望不一致时，服务端拒绝请求、内容不变，避免覆盖你没看到的修改。

| 请求 | 期望版本字段 | 对应的对象版本 |
|---|---|---|
| `UpdateWorkspaceExpiration` | `expected_revision`，必填 | `expiration.revision` |
| `StartWorkspace`、`StopWorkspace`、`DeleteWorkspace` | `expected_expiration_revision`，必填 | `expiration.revision`。没有设置到期时间时也有版本号，从 1 开始 |
| `UpdateWorkspaceMemory`、`UpdateWorkspaceCpu` | `expected_revision` | `spec.resources_revision`，两者共用一个版本 |
| `UpdateWorkspaceVolumeBinding` | `expected_revision` | `spec.binding_revision`，与资源版本各自独立 |
| `UpdateWorkspaceNetworkPolicy` | `expected_revision`，可以不带 | `spec.network_policy.revision`。为 0 时不检查；不为 0 时即使内容与当前相同，版本不一致也拒绝 |
| `UpdateWorkspaceLabels`、`UpdateWorkspaceAnnotations` 及 Volume、Egress、Resolver 上同形的方法 | `expected_revision` | 对象的 `labels_revision` 或 `annotations_revision` |
| `UpdateEgress`、`UpdateResolver` | `expected_revision`，必填 | 对象的 `revision` |

- `ResizeWorkspaceWritableLayer` 与 `ResizeVolume` 没有期望版本，只有幂等键和目标容量。
- `UpdateWorkspaceNetworkPolicy` 的 `expected_revision` 需要服务端宣告 `workspace.network_policy.update.expected_revision`，较旧的服务端会忽略它、不做检查。
- 内容与当前相同的修改直接成功，版本号不变。
- Operator API 也有同类字段，本站不展开。

### aborted 与 failed_precondition {#aborted-vs-failed-precondition}

- **版本不一致返回 `aborted`**，`ErrorDetail.reason` 为 `CONFLICT`，内容不变。对 Workspace 的修改，错误详情里的 `observed_workspace` 带着当前的版本。含义是：对象在你读取之后被别人改过。
- **到期设置的版本是例外。** `UpdateWorkspaceExpiration` 的 `expected_revision`，以及启动、停止、删除的 `expected_expiration_revision` 不一致时返回 `failed_precondition`。
- **`failed_precondition` 的一般含义**是对象当前的状态不允许这个操作，例如对运行中的 Workspace 调整内存。`UpdateWorkspaceExpiration` 设置到期时间只在 Workspace 为 `AVAILABLE` 时接受，状态不对与版本不一致返回同一个错误码，用 `observed_workspace` 里的状态与版本区分。

收到这两种错误后，重新读取对象，按当前状态与版本决定下一步。不要自动拿新版本重放旧的请求：那会覆盖掉你没看到的修改。

## 错误格式 {#errors}

错误使用 Connect 的标准错误码，例如 `invalid_argument`、`not_found`、`failed_precondition`、`unavailable`。多数错误在错误详情里附带一个 `kibotos.ctrl.v1.ErrorDetail`：

| 字段 | 含义 |
|---|---|
| `reason` | 更具体的原因，`FailureReason` 枚举，例如 `CONFLICT`、`CAPABILITY_UNAVAILABLE`、`SESSION_EXPIRED`、`VOLUME_LOST` |
| `stage` | 失败发生的阶段，`FailureStage` 枚举 |
| `retryable` | 原样重发是否可能成功 |
| `message` | 给人读的说明，不要据此分支 |
| `observed_workspace`、`observed_volume`、`observed_transfer` | 失败时对象的实际状态 |
| `accepted_bytes` | 只出现在 `SendInput` 返回的 `resource_exhausted` 上：guest 在拒绝之前已经接收的字节数 |
| `input_offset` | 只出现在带 `input_offset` 的 `SendInput` 失败时：进程已经接受的输入字节数 |

- 按错误码与 `reason` 决定处理方式；`kibo` 也是优先按 `reason`、其次按错误码决定退出码。
- `retryable` 为 `true` 时，用同一个幂等键原样重发；为 `false` 时，原样重发不会成功，要先改变请求或对象的状态。
- 并非所有错误都带 `ErrorDetail`。注册与续期、身份认证失败、Template 目录的部分错误只有错误码与消息。
- 使用 JSON 的一元调用出错时，响应体形如 `{"code": "failed_precondition", "message": "…", "details": [...]}`。`details` 的每一项有 `type`（例如 `kibotos.ctrl.v1.ErrorDetail`）和 `value`（protobuf 编码后再做 base64）。HTTP 状态码由错误码决定，判断时以 `code` 为准。用 Connect 客户端库可以直接取出类型化的详情。
- `/v1/files` 与 `/v1/service` 两个 HTTP 入口的错误响应体是 `{"code": …, "detail": …}`，见 [/v1/files 的 HTTP 状态](/reference/errors#files-http)。

错误码、`FailureReason` 全部取值及处理方式见[原生 API 错误](/reference/errors#native)。

## 分页 {#pagination}

`ListTemplates`、`ListWorkspaces`、`ListVolumes`、`ListExposures`、`ListEgresses` 与 `ListResolvers` 分页返回结果：

| 字段 | 规则 |
|---|---|
| `page_size` | 每页条数。0 使用服务端默认值 50；超过服务端上限 100 时返回 `invalid_argument`，不会被悄悄改小 |
| `page_token` | 上一页响应的 `next_page_token`，不透明，原样传回。第一页不带 |
| `next_page_token` | 还有下一页时非空；为空表示已经到最后一页 |
| `completeness` | 结果是否完整：`COMPLETENESS_COMPLETE`、`COMPLETENESS_PARTIAL` 或 `COMPLETENESS_UNKNOWN`。不是 `COMPLETENESS_COMPLETE` 时，没出现的条目不能当作不存在 |

- 游标只对取得它的那组筛选条件有效。`label_selector` 与 `ListWorkspaces` 的 `guest_condition` 在翻页时必须与第一页相同；其余筛选条件也保持不变。
- 逐页读取不是同一时刻的快照，期间新建或删除的对象可能出现，也可能不出现。
- `ListWorkspaces` 与 `ListVolumes` 默认不返回已删除的对象，`include_deleted` 为真时一并返回。`ListWorkspaces` 的 `states` 只返回给出的状态，取值必须有效且不重复，与 `include_deleted` 不能同时使用。

## 兼容窗口 {#compatibility}

- 兼容承诺从 `v0.1.0` 开始，覆盖 `kibotos.ctrl.v1`、`kibotos.operator.v1`、`kibotos.enrollment.v1` 与 `kibotos.service.v1`，以及数据面的会话凭证用法、`/v1/files` 与公开的 WebSocket 入口。
- 不兼容变更仍可能发生，但会留一个 MINOR 版本的过渡期：被取代的字段或方法在引入新形态的版本里继续工作并标记为 `deprecated`，最早在下一个 MINOR 版本删除。PATCH 版本不删除任何东西。
- 新形态由一个新的能力名宣告，过渡期内新旧两个名字同时出现在 `GetServerInfo` 里。判断服务端提供哪种形态，仍然只按能力名精确匹配。
- 每一次不兼容变更都写在变更记录对应版本的「升级须知」里。
- `kibo` 的参数与输出、源码仓库 `gen/go/` 下的 Go 生成代码不在承诺范围内。

完整规则见[兼容策略](/releases/compatibility)，各版本的变化见[变更记录](/releases/changelog)。

## 相关文档 {#related}

- [能力名清单](/reference/capabilities)
- [错误码](/reference/errors)
- [Workspace](/integrate/native-api/workspaces)
- [身份与认证](/integrate/native-api/authentication)
