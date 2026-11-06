---
title: 运行状况观测
description: 从 Workspace 的观测字段判断运行状况：guest 是否还在回应、内存饱和与自动处置、停止原因与宿主内存耗尽、guest 自己重启或关机、执行的释放情况，以及网络、Egress、Resolver 与 Template 交付的观测。
---

# 运行状况观测

本页说明 Workspace 上报告运行状况的字段：guest 是否还在回应、里面的进程是否卡在内存上限、Workspace 为什么停了、guest 自己重启或关机之后会怎样，以及删除之后资源是否真的释放。读者是需要监控 Workspace、自动处理异常的集成开发者。

## 概述 {#overview}

这些字段都是观测，不是状态：

- 它们不改变 Workspace 的 `state`，准入与到期回收也不看它们。例如 guest 不再回应时，Workspace 仍是 `AVAILABLE`。
- `GetWorkspace` 与 `ListWorkspaces` 只读 ctrl 记下的报告，不会为此访问 node。从情况出现到 ctrl 读得到，一般在 2 分钟以内。
- `guest_observation`、`egress_observations` 与 `resolver_observations` 的 `observed_at` 是 ctrl 记下报告的时间，取 ctrl 的时钟；`failing_since`、`unresponsive_since` 这类起始时间取 node 的时钟。
- 新版本可能为观测里的枚举增加取值。遇到不认识的值时按「有问题」处理，不要当作正常。

| 观测 | 位置 | 本页章节 |
|---|---|---|
| guest 回应与内存状况 | `Workspace.guest_observation` | [guest 是否还在回应](#guest-observation)、[内存饱和与处置](#memory-saturation) |
| 停止原因 | `Workspace.last_stop` | [停止原因](#stop-cause) |
| 执行的释放情况 | `WorkspaceObservationService/GetWorkspaceCleanup` | [释放情况](#cleanup) |
| Template 交付进度 | `Workspace.delivery` | [Template 交付进度](#template-delivery) |
| 网络策略的生效情况与出口故障 | `network_policy_status`、`egress_observations`、`resolver_observations` | [网络相关的观测](#network-observation) |
| Volume 的数据状况 | `Volume.observation` | [Volume 与 Transfer](/integrate/native-api/volumes-transfers) |

## guest 是否还在回应 {#guest-observation}

运行当前执行的 node 定期探测 guest，连续几次超时或连不上时判为不再回应，回应一次即解除。`guest_observation` 是 node 最近一次报告的结果：

| 字段 | 含义 |
|---|---|
| `condition` | `GUEST_CONDITION_RESPONDING` 或 `GUEST_CONDITION_UNRESPONSIVE` |
| `unresponsive_since` | 只在 `UNRESPONSIVE` 时有值：第一次失败的探测，取 node 的时钟 |
| `error` | 最近一次探测失败的原因；`RESPONDING` 时为空 |
| `rebooted` | guest 回应时报告的启动与这次执行开始时不同 |
| `restart_count` | 这次执行里 guest 自己复位、node 换了 VMM 的次数，见 [guest 自己重启或关机](#guest-reboot)；下一次执行从 0 开始 |
| `last_reset_at` | 只在 `restart_count` 不为 0 时有值：guest 最近一次复位的时间，取 node 的时钟 |
| `observed_at` | ctrl 记下这份报告的时间 |
| `memory_condition`、`memory_saturated_since`、`memory_kill_count`、`latest_memory_kill` | 内存状况，见[内存饱和与处置](#memory-saturation) |

- **什么时候没有。** 以下情况不带它：Workspace 没有当前执行（例如 `STOPPED`）、node 尚未上报，以及 guest 自己重启、正在回来的期间。
- **不再回应时。** 数据面请求在这期间照常超时。guest 可能自己恢复；一直不恢复时，用[强制停止](/integrate/native-api/workspaces#force-stop)收回，再启动。
- **筛选。** `ListWorkspaces` 的 `guest_condition` 只返回当前观测为该值的 Workspace，没有观测的 Workspace 不会被选中；它可以与 `states`、`label_selector` 组合，翻页时必须与第一页相同。
- **能力名。** `workspace.guest_observation`。较旧的服务端会忽略 `guest_condition`、返回全部 Workspace，筛选前先确认能力名存在。
- `restart_count` 与 `last_reset_at` <Badge type="tip" text="v0.3.0 新增" /> 只新增，没有单独的能力名；较旧的服务端不返回它们。

## 内存饱和与处置 {#memory-saturation}

guest 回应正常，不代表里面的进程在干活。guest 没有 swap，进程合计用到内存上限时，内核总能从这些进程自己的文件页（代码、读入的文件）里回收出一点，于是反复回收、再读回，不会触发 OOM。进程几乎停滞，可以持续数小时，而 guest 照常回应探测。`memory_condition` <Badge type="tip" text="v0.2.0 新增" /> 报告这种状态：

| 值 | 含义 |
|---|---|
| `GUEST_MEMORY_CONDITION_UNSPECIFIED` | 未知，不等于正常。Workspace 使用的 Platform 或 node 早于这项上报、guest 内核不统计内存压力，或者 guest 不再回应 |
| `GUEST_MEMORY_CONDITION_NORMAL` | guest 在统计内存压力，进程没有卡在上限 |
| `GUEST_MEMORY_CONDITION_SATURATED` | 在最近一段持续的时间里，进程大部分时间全部卡在等内存上；`memory_saturated_since` 是开始的时间，取 node 的时钟 |

- **判定。** guest 监听受管进程所在 cgroup 的内存压力（PSI），按最近 60 秒统计全部进程同时卡住的时间占比。整个窗口达到 25% 判为饱和，降到 10% 以下解除。短时的内存高峰占不满窗口，不会判为饱和；内存占满但进程不卡在等内存上，比如空闲的 Workspace，占比接近 0。
- **它同样是观测。** 饱和不改变 Workspace 的状态、准入与到期回收。需求降下来后会自己解除。
- **生效范围。** guest 侧的判定随 Platform 交付，Workspace 用上带这项上报的 Platform 之后才有，通常要重新启动一次。

饱和持续下去时，guest 向其中占用内存最多的进程发 `SIGKILL`，让其余进程继续运行 <Badge type="tip" text="v0.3.0 新增" />：

- **什么时候杀。** 同时满足三条：饱和已经持续 2 分钟；当前 60 秒窗口的占比仍不低于 25%；这段时间里进程确实撞到过内存上限。占比已经回落到 25% 以下的不杀，它在继续报饱和但已经能往前走；没撞到上限的停滞是整个 guest 缺内存，交给内核的 OOM killer。
- **杀谁。** 受管进程里常驻内存（RSS）最大的一个。guest 的代理程序与平台进程不在其中，不会被选中。只杀这一个进程，它的子进程和同一会话的其他进程不受影响，除非它们随它退出。
- **杀完之后。** 60 秒冷却期内不再杀。冷却期结束仍符合上面三条的，按同样的规则杀下一个。
- **对调用方的影响。** 被杀的进程按被信号 9 杀死退出，看起来与内核 OOM 杀进程一样。依赖某个进程一直存活的程序，要处理它以信号 9 退出的情况。

要区分是不是这种处置，读下面两个字段。它们随 guest 重启清零，guest 不再回应时仍保留，Workspace 停止后消失：

| 字段 | 含义 |
|---|---|
| `memory_kill_count` | guest 自这次启动以来因内存饱和杀掉的进程数。早于这项上报的 guest 不杀进程，为 0 |
| `latest_memory_kill` | 最近一次被杀的进程，`memory_kill_count` 为 0 时没有：`pid`、`command`（进程名，不含参数）、`rss_bytes`、`killed_at`，以及决定这次处置的 `full_stall_permille`（窗口内全部进程卡住的千分比）、`window`、`saturated_for` |

处置解决不了的情况：

- tmpfs（`/tmp`、`/run`、`/dev/shm`）里的数据占用内存但不属于任何进程，杀进程释放不了。
- 占比一直低于 25% 的抖动不会判为饱和，也就不会被处置。

这两种情况下，用强制停止再启动恢复，或者调大内存后再启动，见[调整资源](/integrate/native-api/workspaces#resources)。受管进程能用多少内存见 [guest 内的资源上限](/integrate/native-api/data-plane#guest-limits)。

## 停止原因 {#stop-cause}

Workspace 在 `STOPPING` 与 `STOPPED` 时带 `last_stop`，说明是哪一次停止把它带到这里；`StartWorkspace` 与 `DeleteWorkspace` 被接受之后不再返回它。

| 字段 | 含义 |
|---|---|
| `cause` | 停止原因，见下表 |
| `command_id` | 这次停止的命令，可以用 `GetWorkspaceCommand` 查结果 |
| `durability` | 停止完成后与命令结果相同：`STOP_DURABILITY_CONFIRMED` 或 `STOP_DURABILITY_UNCONFIRMED`；停止完成之前为 `STOP_DURABILITY_UNSPECIFIED` |

| `cause` | 含义 | 命令 ID |
|---|---|---|
| `STOP_CAUSE_REQUESTED` | 调用方的 `StopWorkspace`，正常停止或强制停止 | 调用方给出的幂等键 |
| `STOP_CAUSE_EXPIRED` | 到期设置的停止动作 | 以 `expiration/` 开头 |
| `STOP_CAUSE_HOST_MEMORY_EXHAUSTED` | 宿主内存耗尽，内核杀掉了这台 VM，服务端随后强制停止 | 以 `host-memory/` 开头 |
| `STOP_CAUSE_GUEST_SHUTDOWN` <Badge type="tip" text="v0.3.0 新增" /> | guest 自己关机，服务端随后强制停止，见 [guest 自己重启或关机](#guest-reboot) | 以 `guest-shutdown/` 开头 |
| `STOP_CAUSE_UNSPECIFIED` | 由不记录原因的旧版本完成的停止 | |

`expiration/`、`host-memory/` 与 `guest-shutdown/` 三个前缀保留给服务端，调用方的幂等键使用它们时返回 `invalid_argument`。

### 宿主内存耗尽 {#host-memory}

宿主内存耗尽时，内核会杀掉宿主上的一台 VM。这台 VM 的 Workspace 不需要调用方处理：

- 服务端自行对它执行强制停止，Workspace 进入 `STOPPED`，`last_stop.cause` 为 `STOP_CAUSE_HOST_MEMORY_EXHAUSTED`，`durability` 为 `STOP_DURABILITY_UNCONFIRMED`。直接 `StartWorkspace` 即可继续使用，Volume 与保留的可写层都保留。
- 服务端完成停止之前，Workspace 会短暂处于 `FAILED`，`failure.message` 写明宿主内存不足。
- Workspace 已经开始删除，或者有其他命令正在处理时，服务端不发起这次停止；这时按 `FAILED` 的恢复步骤处理，见[强制停止](/integrate/native-api/workspaces#force-stop)。

## guest 自己重启或关机 {#guest-reboot}

guest 里的程序可以自己重启或关闭这台机器。两种情形都不是故障，不需要平台运营方处理。它们的处理方式取决于 Workspace 运行在哪种虚拟化后端上：部署使用 Firecracker 还是 KiboVM，可向平台运营方确认。

### 重启 {#guest-restart}

`reboot -f`、`echo b > /proc/sysrq-trigger` 这类复位，在 Firecracker 后端上：

- node 在同一个 Instance、同一台 node 上启动新的 VMM。Workspace 始终是 `AVAILABLE`，`generation` 与会话凭证都不变。
- Volume 与可写层保留，内存与进程不保留；没有落盘的写入可能丢失。
- guest 回来之前，数据面的新请求返回可重试的 `unavailable`，已经建立的流随旧 VMM 结束。
- 这段时间 Workspace 不带 `guest_observation`。guest 回来、node 下一次上报之后，`rebooted` 为 `true`，`restart_count` 加 1，`last_reset_at` 是这次复位的时间。
- 10 分钟内复位超过 3 次时不再重启，Workspace 进入 `FAILED`，`failure.message` 写明复位次数，按[强制停止](/integrate/native-api/workspaces#force-stop)恢复。
- 新 VMM 没有启动成功，或者重启进行到一半时 node 自身重启，Workspace 也进入 `FAILED`，`failure.message` 写明原因。

KiboVM 后端目前不做这样的重启：复位与 VMM 内部故障的退出码相同，node 无法区分，一律按故障处理，Workspace 进入 `FAILED` 并仍持有执行，按[强制停止](/integrate/native-api/workspaces#force-stop)恢复。

### 关机 {#guest-shutdown}

`poweroff -f` 或 `reboot(2)` 的 `POWER_OFF` <Badge type="tip" text="v0.3.0 新增" />。目前只有 KiboVM 后端会因 guest 关机而结束 VMM：

- 服务端自行对它执行强制停止，Workspace 进入 `STOPPED`，`last_stop.cause` 为 `STOP_CAUSE_GUEST_SHUTDOWN`，`durability` 为 `STOP_DURABILITY_UNCONFIRMED`。直接 `StartWorkspace` 即可继续使用，Volume 与可写层保留。
- 停止完成之前 Workspace 仍是 `AVAILABLE`，这段时间数据面请求被拒绝。
- 到期设置按停止的规则处理。Workspace 已经开始删除，或者有其他命令正在处理时，服务端不发起停止，等下一次上报再判断。
- 服务端支持这一行为时宣告能力名 `workspace.stop.guest_shutdown`。按 `last_stop.cause` 判断停止原因的程序，把 `STOP_CAUSE_GUEST_SHUTDOWN` 当作一次可以直接启动的停止。

## 释放情况 {#cleanup}

`WorkspaceObservationService/GetWorkspaceCleanup`（参数 `workspace_id`）报告一个 Workspace 的执行已经释放了哪些部分、还占着哪些部分。停止或删除之后想确认资源是否真的放掉时用它。它只是读取：释放由服务端照常进行，Workspace 的状态不受影响。这个方法没有单独的能力名。

响应的 `cleanup`：

| 字段 | 含义 |
|---|---|
| `state` | 总体状态，见下表 |
| `components` | 逐项列出执行的各个部分，每项有 `kind`、`state`、`source` 与 `observed_at`。来源为 `CLEANUP_SOURCE_RUNTIME_INVENTORY` 的几项，清理完成后 `observed_at` 是 node 观测到清理完成的时刻 |
| `completeness` | 观测本身是否完整：`COMPLETENESS_COMPLETE`、`COMPLETENESS_PARTIAL` 或 `COMPLETENESS_UNKNOWN` |
| `pending_since` | 释放还没有完成时，从什么时候起欠着这次释放。只用于诊断，不是期限 |
| `runtime_confirmed_at` | 最后一次确认执行的时间 |
| `observed_at` | 这份观测的时间 |

| 总体 `state` | 含义 |
|---|---|
| `CLEANUP_STATE_COMPLETE` | Workspace 已删除，各部分都已释放 |
| `CLEANUP_STATE_PROCESSING` | 还有部分没有释放，释放仍在进行。没有删除的 Workspace 总体状态不会是 `CLEANUP_STATE_COMPLETE`，看各部分即可 |
| `CLEANUP_STATE_NEEDS_ATTENTION` | Workspace 已删除，但仍有部分存在或被隔离 |
| `CLEANUP_STATE_UNKNOWN` | 有部分的情况未知 |

| 部分 `kind` | 含义 |
|---|---|
| `CLEANUP_COMPONENT_KIND_ENTRY` | ctrl 里的 Workspace 记录 |
| `CLEANUP_COMPONENT_KIND_SESSIONS` | 会话凭证是否已全部撤销 |
| `CLEANUP_COMPONENT_KIND_RUNTIME` | node 上的执行（Instance） |
| `CLEANUP_COMPONENT_KIND_VOLUME_BINDING` | Volume 绑定 |
| `CLEANUP_COMPONENT_KIND_VOLUME_ATTACHMENT` | node 上 Volume 的挂载 |
| `CLEANUP_COMPONENT_KIND_RESIDUAL` | 执行在 node 上留下的其他残余 |
| `CLEANUP_COMPONENT_KIND_RETAINED_LAYER` | 保留的可写层 |
| `CLEANUP_COMPONENT_KIND_VOLUME_DELETION` | 随 Workspace 删除的 Volume 的物理删除 |

每部分的 `state` 与 `source`：

| 部分 `state` | 含义 |
|---|---|
| `CLEANUP_COMPONENT_STATE_RELEASED` | 已释放 |
| `CLEANUP_COMPONENT_STATE_PRESENT` | 仍存在 |
| `CLEANUP_COMPONENT_STATE_PENDING` | 等待释放 |
| `CLEANUP_COMPONENT_STATE_ISOLATED` | 已隔离 |
| `CLEANUP_COMPONENT_STATE_UNKNOWN` | 情况未知 |

| `source` | 这一项读自哪里 |
|---|---|
| `CLEANUP_SOURCE_CONTROL_STATE` | ctrl 的记录 |
| `CLEANUP_SOURCE_SESSION_AUTHORITY` | 会话凭证的签发记录 |
| `CLEANUP_SOURCE_RUNTIME_INVENTORY` | node 报告的执行清单 |
| `CLEANUP_SOURCE_RETAINED_LAYER_INVENTORY` | node 报告的可写层清单 |

- `completeness` 为 `COMPLETENESS_PARTIAL` 或 `COMPLETENESS_UNKNOWN` 时，未知的部分不能当作已释放。
- `CLEANUP_COMPONENT_KIND_RETAINED_LAYER` 或 `CLEANUP_COMPONENT_KIND_VOLUME_DELETION` 为 `CLEANUP_COMPONENT_STATE_PENDING`、来源是 `CLEANUP_SOURCE_CONTROL_STATE` 时，Workspace 已删除，文件要等所在存储池有可用的 node 时再删除；总体状态在这期间是 `CLEANUP_STATE_PROCESSING`。
- 存储池被平台运营方宣告丢失之后，这两项是 `CLEANUP_COMPONENT_STATE_RELEASED`：池里已经没有可以读到的数据。

## Template 交付进度 {#template-delivery}

一个 node 第一次使用某个 Template 时，要先把它的文件传过来，`CREATING` 或 `STARTING` 可能持续几分钟。等待期间 Workspace 带 `delivery`，Workspace 可用后消失：

| 字段 | 含义 |
|---|---|
| `state` | `TEMPLATE_DELIVERY_STATE_READY`、`TEMPLATE_DELIVERY_STATE_NOT_READY` 或 `TEMPLATE_DELIVERY_STATE_UNKNOWN` |
| `reason` | 未就绪的原因：`TEMPLATE_DELIVERY_REASON_DISTRIBUTING`（正在传输）、`TEMPLATE_DELIVERY_REASON_CAPABILITY_MISMATCH`、`TEMPLATE_DELIVERY_REASON_NO_SUPPORTED_PATH`、`TEMPLATE_DELIVERY_REASON_OBSERVATION_STALE`、`TEMPLATE_DELIVERY_REASON_PREPARATION_FAILED` |
| `transferred_bytes`、`total_bytes` | 已传输与总字节数，未知时为 0。用来区分「还在传」与「卡住了」 |
| `observed_at`、`completeness` | 观测时间与完整性 |

`reason` 长时间不是 `TEMPLATE_DELIVERY_REASON_DISTRIBUTING`，或者字节数长时间不变时，联系平台运营方。

## 网络相关的观测 {#network-observation}

- `network_policy_status`：node 上已经确认生效的网络策略，判断策略是否生效看它，见[网络策略与 DNS](/integrate/native-api/network-policy)。
- `egress_observations`：Egress 端点自身的故障，例如连不上、TLS 校验失败、认证被拒。
- `resolver_observations`：Resolver 上游这一段的故障，例如超时、HTTP 错误状态。

这两类观测的取值与规则见 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。它们同样不改变 Workspace 状态，故障持续时内容不变，下一次成功后清除。

## 相关文档 {#related}

- [Workspace](/integrate/native-api/workspaces)：状态、强制停止与恢复步骤。
- [数据面：文件与进程](/integrate/native-api/data-plane)：guest 内的资源上限。
- [Egress 与 Resolver](/integrate/native-api/egress-resolver)：出口与 DNS 上游的观测。
- [常见问题排查](/integrate/troubleshooting)：按现象排查。
