---
title: 能力名清单
description: 服务端在 GetServerInfo 中宣告的全部能力名：命名规则、v0.1.0 的完整清单、v0.2.0 与 v0.3.0 新增的名字及其对应的方法或字段，以及没有能力名的接口。
---

# 能力名清单

本页列出 Kibotos 服务端在 `GetServerInfo` 中可能宣告的全部能力名（capability），以及每个名字对应的方法或字段。调用方据此判断所接入的部署支持哪些操作。用法见[能力协商](/integrate/native-api/conventions#capabilities)。

## 用法 {#usage}

- 调用 `kibotos.ctrl.v1.ServerInfoService/GetServerInfo`，读响应里的 `capabilities`。
- 按名字精确匹配。一个操作需要的名字不在列表里时，只让这一个操作失败，其他操作照常进行。判断依据只有能力名，与版本号无关。
- 写入较新的字段之前先确认对应的名字存在：较旧的服务端会静默丢掉它不认识的字段。
- 用 `kibo` 时，`kibo version --wide` 显示当前 ctrl 宣告的能力名清单。

## 命名规则 {#naming}

名字按下面的规则取，以后新增的名字也一样：

| 规则 | 写法 | 例子 |
|---|---|---|
| 资源操作，动词取自方法名 | `<资源>.<动词>` | `CreateWorkspace` 是 `workspace.create`，`ResizeVolume` 是 `volume.resize` |
| 修改资源的一部分 | `<资源>.<部分>.<动词>` | `UpdateWorkspaceCpu` 是 `workspace.cpu.update`，`ResizeWorkspaceWritableLayer` 是 `workspace.writable_layer.resize` |
| 已有操作后来增加的选项或字段 | `<操作或资源>.<选项>` | `workspace.stop.force`、`volume.storage_pool` |
| node 数据面上的服务 | `workspace.<服务>` | `workspace.filesystem`、`workspace.process` |

多个词之间用下划线，与字段名一致。不兼容变更的新形态也由一个新的名字宣告，过渡期内新旧两个名字同时出现，见[兼容策略](/releases/compatibility)。

## v0.1.0 {#v0-1-0}

`v0.1.0` 宣告的完整清单。兼容承诺从这个版本开始。

### Template {#v0-1-0-template}

| 能力名 | 对应的方法或字段 |
|---|---|
| `template.get` | `TemplateService/GetTemplate` |
| `template.list` | `TemplateService/ListTemplates` |

### Workspace 生命周期 {#v0-1-0-workspace-lifecycle}

| 能力名 | 对应的方法或字段 |
|---|---|
| `workspace.create` | `WorkspaceService/CreateWorkspace` |
| `workspace.get` | `WorkspaceService/GetWorkspace` |
| `workspace.list` | `WorkspaceService/ListWorkspaces` |
| `workspace.start` | `WorkspaceService/StartWorkspace` |
| `workspace.stop` | `WorkspaceService/StopWorkspace` |
| `workspace.delete` | `WorkspaceService/DeleteWorkspace` |
| `workspace.command.get` | `WorkspaceService/GetWorkspaceCommand` |

### Workspace 配置 {#v0-1-0-workspace-config}

| 能力名 | 对应的方法或字段 |
|---|---|
| `workspace.cpu.update` | `WorkspaceService/UpdateWorkspaceCpu` |
| `workspace.memory.update` | `WorkspaceService/UpdateWorkspaceMemory` |
| `workspace.expiration.update` | `WorkspaceService/UpdateWorkspaceExpiration` |
| `workspace.network_policy.update` | `WorkspaceService/UpdateWorkspaceNetworkPolicy` |
| `workspace.volume_binding.update` | `WorkspaceService/UpdateWorkspaceVolumeBinding` |
| `workspace.writable_layer.resize` | `WorkspaceService/ResizeWorkspaceWritableLayer` |

### Workspace 的选项与字段 {#v0-1-0-workspace-options}

| 能力名 | 对应的方法或字段 |
|---|---|
| `workspace.stop.force` | `StopWorkspaceRequest.mode` 为 `STOP_MODE_FORCE` 的强制停止 |
| `workspace.labels` | Workspace 的 `labels`：`CreateWorkspaceRequest.labels`、`UpdateWorkspaceLabels`、`ListWorkspacesRequest.label_selector` |
| `workspace.annotations` | Workspace 的 `annotations`：`CreateWorkspaceRequest.annotations`、`UpdateWorkspaceAnnotations` |
| `workspace.guest_observation` | `Workspace.guest_observation` 与 `ListWorkspacesRequest.guest_condition` |
| `workspace.session.execution` | `CreateDataPlaneSessionRequest.lifetime` 为 `DATA_PLANE_SESSION_LIFETIME_EXECUTION` |

### 数据面 {#v0-1-0-data-plane}

| 能力名 | 对应的方法或字段 |
|---|---|
| `workspace.filesystem` | `FilesystemService` 的 `Stat`、`ListDir`、`MakeDir`、`Move`、`Remove`，以及 HTTP `/v1/files` |
| `workspace.process` | `ProcessService` |
| `workspace.desktop` | `DesktopService` |
| `workspace.service_connection` | `ServiceConnectionService/Connect` 与 HTTP `/v1/service` |

### Volume {#v0-1-0-volume}

| 能力名 | 对应的方法或字段 |
|---|---|
| `volume.create` | `VolumeService/CreateVolume` |
| `volume.get` | `VolumeService/GetVolume` |
| `volume.list` | `VolumeService/ListVolumes` |
| `volume.resize` | `VolumeService/ResizeVolume` |
| `volume.delete` | `VolumeService/DeleteVolume` |
| `volume.command.get` | `VolumeService/GetVolumeCommand` |
| `volume.labels` | Volume 的 `labels`：`CreateVolumeRequest.labels`、`UpdateVolumeLabels`、`ListVolumesRequest.label_selector` |
| `volume.annotations` | Volume 的 `annotations`：`CreateVolumeRequest.annotations`、`UpdateVolumeAnnotations` |
| `volume.storage_pool` | `VolumeSpec.storage_pool` |

### Transfer {#v0-1-0-transfer}

| 能力名 | 对应的方法或字段 |
|---|---|
| `transfer.export` | `TransferService/ExportWorkspace` |
| `transfer.import` | `TransferService/ImportTransfer` |
| `transfer.import.storage_pool` | `ImportTransferRequest.storage_pool` |
| `transfer.get` | `TransferService/GetTransfer` |
| `transfer.restore` | `TransferService/RestoreWorkspace` |
| `transfer.delete` | `TransferService/DeleteTransfer` |

### Exposure {#v0-1-0-exposure}

这四个名字只在部署配置了 Exposure 专用域名时出现，是否配置取决于部署，可向平台运营方确认。

| 能力名 | 对应的方法或字段 |
|---|---|
| `exposure.create` | `ExposureService/CreateExposure` |
| `exposure.get` | `ExposureService/GetExposure` |
| `exposure.list` | `ExposureService/ListExposures` |
| `exposure.revoke` | `ExposureService/RevokeExposure` |

## v0.2.0 新增 {#v0-2-0}

| 能力名 | 对应的方法或字段 | 说明页 |
|---|---|---|
| `workspace.filesystem.watch_dir` <Badge type="tip" text="v0.2.0 新增" /> | `FilesystemService/WatchDir` | [目录监视](/integrate/native-api/data-plane#watch-dir) |
| `workspace.network_policy.destination_rules` <Badge type="tip" text="v0.2.0 新增" /> | `NetworkPolicy.allow` 与 `NetworkPolicy.deny` | [判定顺序](/integrate/native-api/network-policy#destination-rules) |
| `workspace.network_policy.update.expected_revision` <Badge type="tip" text="v0.2.0 新增" /> | `UpdateWorkspaceNetworkPolicyRequest.expected_revision` | [版本校验](/integrate/native-api/conventions#expected-revision) |
| `workspace.process.resume` <Badge type="tip" text="v0.2.0 新增" /> | `AttachRequest.resume_from` 与 `SendInputRequest.input_offset` | [进程流续传](/integrate/native-api/data-plane#process-resume) |

## v0.3.0 新增 {#v0-3-0}

| 能力名 | 对应的方法或字段 | 说明页 |
|---|---|---|
| `workspace.network_policy.egress.socks5` <Badge type="tip" text="v0.3.0 新增" /> | `EgressService`、`NetworkPolicy.egresses`、`UpdateWorkspaceNetworkPolicyRequest.drain_seconds`，以及 `network_policy_status.egresses` 与 `egress_observations`。以后每种出口协议一个名字 | [Egress 与 Resolver](/integrate/native-api/egress-resolver) |
| `workspace.network_policy.resolver` <Badge type="tip" text="v0.3.0 新增" /> | `ResolverService`、`NetworkPolicy.resolvers`、`EgressSpec.udp_enabled`，以及 `network_policy_status.resolvers` 与 `resolver_observations` | [Egress 与 Resolver](/integrate/native-api/egress-resolver) |
| `workspace.stop.guest_shutdown` <Badge type="tip" text="v0.3.0 新增" /> | guest 关机后 Workspace 进入 `STOPPED`，`last_stop.cause` 为 `STOP_CAUSE_GUEST_SHUTDOWN` | [guest 自己重启或关机](/integrate/native-api/observability#guest-reboot) |
| `volume.lost` <Badge type="tip" text="v0.3.0 新增" /> | `VOLUME_STATE_LOST` 与 `FAILURE_REASON_VOLUME_LOST` | [Volume 与 Transfer](/integrate/native-api/volumes-transfers) |

## 没有能力名的接口 {#without-capability}

下面的接口没有单独的能力名：

| 接口 | 说明 |
|---|---|
| `ServerInfoService/GetServerInfo` | 能力协商本身，`v0.1.0` 起总是可用 |
| `DataPlaneSessionService/CreateDataPlaneSession` | `v0.1.0` 起总是可用；其中 `lifetime` 为 `EXECUTION` 需要 `workspace.session.execution` |
| `WorkspaceService/RevokeWorkspaceDataPlane` | `v0.1.0` 起总是可用 |
| `WorkspaceObservationService/GetWorkspaceCleanup` | 没有单独的名字 |
| `TemplateService/GetTemplateRevision` | 没有单独的名字 |
| `kibotos.enrollment.v1.EnrollmentService` 的 `Enroll` 与 `Renew` | 注册与续期 |
| `kibotos.operator.v1` 的全部服务 | Operator API。后续版本新增的 Operator 方法同样没有能力名，以变更记录为准 |

后来加入的观测字段也没有单独的名字，例如 `GuestObservation` 的 `memory_condition`（`v0.2.0`）、`restart_count`、`last_reset_at`、`memory_kill_count` 与 `latest_memory_kill`（`v0.3.0`）。较旧的服务端不返回它们，读到零值时按「没有报告」处理。

## 相关文档 {#related}

- [调用约定](/integrate/native-api/conventions#capabilities)：能力协商的规则。
- [兼容策略](/releases/compatibility)：新形态怎样通过能力名宣告。
- [变更记录](/releases/changelog)：每个版本新增与变化的内容。
- [概述与协议](/integrate/native-api/overview)：服务与方法总表。
