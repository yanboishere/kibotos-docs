---
title: 错误码
description: 原生 API 的 Connect 错误码、ErrorDetail 字段、FailureReason 与 FailureStage 的全部取值和 retryable 的用法，/v1/files 的 HTTP 状态映射，kibo 的退出码，以及 E2B 网关错误的去处。
---

# 错误码

本页是错误的参考表：原生 API 返回哪些错误码、错误详情里有什么、每种原因怎样处理，以及文件传输入口、`kibo` 与 E2B 网关各自的错误表达。错误处理的通用做法见[错误格式](/integrate/native-api/conventions#errors)。

## 原生 API 错误 {#native}

原生 API 使用 Connect 的标准错误码。多数错误在错误详情里附带一个 `kibotos.ctrl.v1.ErrorDetail`，给出更具体的原因、发生的阶段与是否可以重试。

### Connect 错误码 {#connect-codes}

数值是 `WorkspaceCommand.error_code` 与 `VolumeCommand.error_code` 中使用的值。

| 错误码 | 数值 | 在 Kibotos 中的常见含义 | 处理 |
|---|---|---|---|
| `canceled` | 1 | 调用方取消了请求；或者命令被另一条命令取代，例如强制停止取代正常停止、删除取代其他命令，`reason` 为 `CANCELLED` | 查询对象的当前状态 |
| `invalid_argument` | 3 | 请求不合法：缺少必填字段、取值超出范围、写法不规范、幂等键使用了保留前缀 | 修正请求；原样重发不会成功 |
| `deadline_exceeded` | 4 | 在时限内没有得到确认；`GetWorkspaceCommand` 中表示命令已用完执行时限、结果无法确定 | 查询对象状态后再决定 |
| `not_found` | 5 | 对象不存在，或已删除的 Egress、Resolver 被读取或引用；命令记录不存在 | 核对 ID |
| `already_exists` | 6 | 同一个幂等键配了不同的输入；注册密钥已经用另一个 CSR 注册过；要创建的目录或文件已经存在 | 结果未知时原样重发原请求；发起新操作时换新的幂等键 |
| `permission_denied` | 7 | 身份已撤销或证书不再被接受；会话凭证范围不足或已撤销；写入只读目录 | 见 `reason` |
| `resource_exhausted` | 8 | 容量不足；请求超过大小上限；数据面的上限（进程数、监视流、服务连接、读取过慢）；文件系统空间用尽 | 见 `retryable`：容量类可以稍后重试，上限类要先改变请求 |
| `failed_precondition` | 9 | 对象当前的状态不允许这个操作；到期设置的版本不一致；能力不可用；Volume 丢失 | 重新读取对象，按当前状态决定下一步 |
| `aborted` | 10 | 版本校验失败：对象在你读取之后被改过。少数情况下是服务端内部的并发冲突，例如 `ImportTransfer` 选择 node 的过程中 node 登记不断变化 | 版本冲突时重新读取、基于新版本重新决定；`retryable` 为 `true` 时用同一个幂等键重试 |
| `unimplemented` | 12 | 服务端或 guest 不支持这个功能 | 先确认能力名；有时重启 Workspace 后可用 |
| `internal` | 13 | 服务端内部错误 | 查询对象状态；持续出现时联系平台运营方 |
| `unavailable` | 14 | 暂时不可用：命令仍在执行、node 或存储暂时不可达、对象正在搬迁、guest 正在重启 | 用同一个幂等键重试 |
| `unauthenticated` | 16 | 没有有效的身份或凭证；会话凭证已过期 | 续期身份或重新申请凭证 |

表中没有列出的标准错误码（`unknown`、`out_of_range`、`data_loss`）按未知错误处理：不要自动重试写操作，先查询对象的当前状态。

并非所有错误都带 `ErrorDetail`。注册与续期、身份认证失败，以及 Template 目录的部分错误只有错误码与消息。

### ErrorDetail {#error-detail}

| 字段 | 含义 |
|---|---|
| `reason` | 更具体的原因，`FailureReason` 枚举，见下文 |
| `stage` | 失败发生的阶段，`FailureStage` 枚举，见下文 |
| `retryable` | 原样重发是否可能成功，见 [retryable](#retryable) |
| `message` | 给人读的说明。内容可能变化，不要据此分支 |
| `observed_workspace` | 失败时 Workspace 的实际状态，例如版本冲突时带着当前的版本 |
| `observed_volume` | 失败时 Volume 的实际状态 |
| `observed_transfer` | 失败时 Transfer 的实际状态，例如导出超时时带着当前的 Transfer |
| `accepted_bytes` | 只出现在 `SendInput` 返回的 `resource_exhausted` 上：guest 在拒绝之前已经接收的字节数 |
| `input_offset` | 只出现在带 `input_offset` 的 `SendInput` 失败时：进程已经接受的输入字节数 |

用 Connect 客户端库时，从错误的详情列表里取出类型为 `kibotos.ctrl.v1.ErrorDetail` 的那一项。直接读 JSON 时，一元调用的错误响应体形如 `{"code": "…", "message": "…", "details": [{"type": "kibotos.ctrl.v1.ErrorDetail", "value": "…"}]}`，`value` 是 protobuf 编码后再做 base64；HTTP 状态码由错误码决定，判断以 `code` 为准。

### FailureReason {#failure-reason}

| 值 | 含义 | 常见错误码 |
|---|---|---|
| `FAILURE_REASON_UNSPECIFIED` | 没有更具体的原因 | 按错误码处理 |
| `FAILURE_REASON_INVALID_REQUEST` | 请求不合法 | `invalid_argument` |
| `FAILURE_REASON_NOT_FOUND` | 对象或命令不存在 | `not_found` |
| `FAILURE_REASON_CONFLICT` | 与对象当前的状态、版本或已有命令冲突 | `already_exists`、`aborted`、`failed_precondition` |
| `FAILURE_REASON_RESOURCE_EXHAUSTED` | 容量、配额或上限用尽 | `resource_exhausted` |
| `FAILURE_REASON_CAPABILITY_UNAVAILABLE` | 部署、node、Platform 或 guest 不提供所需的能力，例如没有支持目的地规则的 node、部署没有配置 Exposure 域名、guest 早于某个版本 | `failed_precondition`、`unimplemented` |
| `FAILURE_REASON_UNAUTHENTICATED` | 没有有效的身份或会话凭证 | `unauthenticated` |
| `FAILURE_REASON_PERMISSION_DENIED` | 会话凭证的范围不包含这个操作 | `permission_denied` |
| `FAILURE_REASON_UNAVAILABLE` | 暂时不可用：命令仍在执行、node 或存储暂时不可达、对象正在搬迁、guest 正在重启 | `unavailable` |
| `FAILURE_REASON_TIMED_OUT` | 在时限内没有得到 node 或 guest 的确认，结果可能已经生效 | `deadline_exceeded` |
| `FAILURE_REASON_PROTOCOL_INCOMPATIBLE` | 组件之间的应答不符合约定，通常是版本不匹配 | `failed_precondition` |
| `FAILURE_REASON_SESSION_EXPIRED` | 会话凭证已过期；或者用一个凭证已过期的幂等键重新申请会话 | `unauthenticated`、`failed_precondition` |
| `FAILURE_REASON_SESSION_REVOKED` | 会话凭证已被撤销，或它所属的执行已经结束 | `permission_denied` |
| `FAILURE_REASON_UNSUPPORTED` | 服务端、node 或 guest 不支持请求的内容，例如较早的 guest 不接受 `input_offset` | `unimplemented` |
| `FAILURE_REASON_CANCELLED` | 操作被取消，或命令被另一条命令取代 | `canceled` |
| `FAILURE_REASON_INTERNAL` | 内部错误 | `internal` |
| `FAILURE_REASON_VOLUME_LOST` <Badge type="tip" text="v0.3.0 新增" /> | Workspace 绑定的 Volume 处于 `LOST`，数据已不存在。不可重试：改绑另一个 Volume 或删除 Workspace | `failed_precondition` |

新版本可能增加取值。遇到不认识的 `reason` 时按错误码处理。

### FailureStage {#failure-stage}

`stage` 说明失败发生在哪一步，用于定位问题，不要据此决定是否重试。

| 值 | 阶段 |
|---|---|
| `FAILURE_STAGE_UNSPECIFIED` | 没有给出阶段，例如运行中的执行意外结束 |
| `FAILURE_STAGE_VALIDATING` | 校验请求 |
| `FAILURE_STAGE_PLACING` | 调度：为 Workspace 选择 node |
| `FAILURE_STAGE_CREATING`、`FAILURE_STAGE_WAITING_FOR_READINESS` | 创建执行、等待 guest 就绪 |
| `FAILURE_STAGE_STARTING`、`FAILURE_STAGE_STOPPING`、`FAILURE_STAGE_DELETING` | 启动、停止、删除 Workspace |
| `FAILURE_STAGE_ISSUING_SESSION`、`FAILURE_STAGE_AUTHORIZING_DATA_PLANE`、`FAILURE_STAGE_ROTATING_DATA_PLANE` | 签发会话凭证、数据面鉴权、撤销数据面 |
| `FAILURE_STAGE_READING_FILE`、`FAILURE_STAGE_WRITING_FILE`、`FAILURE_STAGE_DELETING_FILE`、`FAILURE_STAGE_INSPECTING_FILE`、`FAILURE_STAGE_MOVING_FILE`、`FAILURE_STAGE_CREATING_DIRECTORY`、`FAILURE_STAGE_WATCHING_DIRECTORY` | 文件操作与目录监视 |
| `FAILURE_STAGE_STARTING_PROCESS`、`FAILURE_STAGE_STREAMING_PROCESS`、`FAILURE_STAGE_USING_PROCESS` | 启动进程、传输进程输出、操作已有进程 |
| `FAILURE_STAGE_CREATING_VOLUME`、`FAILURE_STAGE_RESIZING_VOLUME`、`FAILURE_STAGE_DELETING_VOLUME` | Volume 的创建、扩容与删除 |
| `FAILURE_STAGE_RESIZING_WRITABLE_LAYER` | 可写层扩容 |
| `FAILURE_STAGE_EXPORTING_WORKSPACE`、`FAILURE_STAGE_IMPORTING_TRANSFER`、`FAILURE_STAGE_RESTORING_WORKSPACE`、`FAILURE_STAGE_DELETING_TRANSFER` | Transfer 的导出、导入、恢复与删除 |
| `FAILURE_STAGE_OBSERVING_CLEANUP` | 读取释放情况 |
| `FAILURE_STAGE_APPLYING_NETWORK` | 应用网络策略 |
| `FAILURE_STAGE_CONNECTING_SERVICE`、`FAILURE_STAGE_USING_SERVICE` | 建立服务连接、使用服务连接 |
| `FAILURE_STAGE_CAPTURING_SCREEN`、`FAILURE_STAGE_DELIVERING_INPUT` | 桌面截图、送达键鼠输入 |
| `FAILURE_STAGE_CREATING_EXPOSURE`、`FAILURE_STAGE_REVOKING_EXPOSURE` | 创建、撤销 Exposure |

### retryable {#retryable}

- `retryable` 为 `true`：同样的请求稍后可能成功。写操作用同一个幂等键原样重发，不要换新键；读操作直接重试。重试之间加入退避。
- `retryable` 为 `false`：原样重发不会成功。先改变请求，或者先改变对象的状态，例如停止 Workspace、改绑 Volume、续期身份。
- 没有 `ErrorDetail` 时，`unavailable` 按可重试处理，其余按不可重试处理。
- `GetWorkspaceCommand` 里处于 `PROCESSING` 的命令带有 `retryable` 为 `true` 的错误时，表示这次尝试遇到暂时的问题，服务端还会继续；为 `false` 时，表示服务端已经用完执行时限、结果无法确定。

## /v1/files 的 HTTP 状态 {#files-http}

`/v1/files` 的错误响应体是 JSON：

```json
{"code": "permission_denied", "detail": {"reason": "FAILURE_REASON_PERMISSION_DENIED", "stage": "FAILURE_STAGE_WRITING_FILE", "message": "…"}}
```

`code` 是 Connect 错误码，`detail` 是 `ErrorDetail` 的 JSON，字段名用 proto 原名，值为零的字段省略。HTTP 状态按错误码映射：

| Connect 错误码 | HTTP 状态 |
|---|---|
| `invalid_argument` | 400 |
| `unauthenticated` | 401 |
| `permission_denied` | 403 |
| `not_found` | 404 |
| `unimplemented` | 405 |
| `already_exists`、`failed_precondition`、`aborted` | 409 |
| `resource_exhausted` | 413 |
| `canceled` | 499 |
| `unavailable` | 503 |
| `deadline_exceeded` | 504 |
| 其他 | 500 |

另外几种情况：

- Range 无法满足返回 416，带 `Content-Range: bytes */<文件大小>`。
- 调用方 5 秒没有发送请求体返回 408。
- `GET`、`PUT` 以外的方法返回 405。
- 写入只读目录返回 403，空间或配额用尽返回 413，两者都不可重试。

服务连接的 WebSocket 入口 `/v1/service` 在升级之前失败时，使用同样的响应体与状态映射；升级之后的失败通过关闭帧表达，见[桌面与服务连接](/integrate/native-api/desktop-services)。

## kibo 退出码 {#kibo-exit-codes}

`kibo` 优先按 `ErrorDetail.reason` 决定退出码，其次按错误码。

| 退出码 | 含义 |
|---|---|
| `0` | 成功。`--no-wait` 返回时对象可能仍在变化，需要再查询状态 |
| `2` | 参数或配置错误、本地对服务端证书的校验失败，或者删除没有确认 |
| `10` | 未认证 |
| `11` | 无权限 |
| `12` | 对象不存在 |
| `13` | 状态或版本冲突，包括同一个幂等键配了不同的输入 |
| `14` | 服务端不支持该操作，例如缺少所需的能力名 |
| `15` | 服务暂时不可用（只读命令；写命令遇到 `unavailable` 时退出 `18`） |
| `16` | 取消或超时，服务端的操作仍在进行 |
| `17` | 结果不完整，例如 `workspace update` 已经生效了一部分 |
| `18` | 结果未知：不能确定服务端是否执行了操作，包括写命令遇到 `unavailable`、超时与等待中止 |
| `21` | 完整性校验失败 |

`kibo workspace exec` 与 `kibo workspace terminal` 例外，与 `ssh` 一致：

| 退出码 | 含义 |
|---|---|
| 远端退出码 | 远端进程正常结束 |
| `128` 加信号编号 | 远端进程被信号终止 |
| `124` | 远端进程超过 `--exec-timeout` 被终止 |
| `255` | `kibo` 自身失败，例如找不到 Workspace、会话被撤销、连接中断后 30 秒内没能续上，或者 `exec` 续上之后有输出丢失 |

错误输出的格式与各退出码的处理建议见 [kibo 命令参考](/reference/kibo-cli#exit-codes)。

## E2B 网关 {#e2b}

E2B 兼容网关面向官方 E2B SDK，返回 E2B 风格的 HTTP 状态码与消息，而不是本页的 Connect 错误码：例如明确未提供的能力返回 501，容量不足返回 503，同一个幂等键换了请求内容或版本冲突返回 409。各接口的状态码与含义见[与 E2B 的差异](/integrate/e2b/differences#status-codes)。

## 相关文档 {#related}

- [调用约定](/integrate/native-api/conventions#errors)：错误格式与处理方式。
- [数据面：文件与进程](/integrate/native-api/data-plane#files-http)：`/v1/files` 的参数与行为。
- [kibo 命令参考](/reference/kibo-cli#exit-codes)：`kibo` 的退出码与错误输出。
- [常见问题排查](/integrate/troubleshooting)：按现象排查。
