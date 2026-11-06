---
title: 数据面：文件与进程
description: 访问 Workspace 数据面的两步：向 ctrl 申请会话凭证、带凭证直连 node；FilesystemService 与 ProcessService 的规则，guest 内的资源上限、目录监视、进程流续传，以及 /v1/files 文件传输。
---

# 数据面：文件与进程

本页说明怎样在运行中的 Workspace 里读写文件、执行进程：先向 ctrl 申请会话凭证，再带着凭证直接访问运行 Workspace 的 node。读者是要让 Agent 操作 Workspace 的集成开发者。桌面与服务连接见[桌面与服务连接](/integrate/native-api/desktop-services)。

## 概述 {#overview}

文件、进程、桌面与服务连接都直接访问 node 的数据面（data plane），不经过 ctrl 转发：

1. 用 Operator 身份调用 ctrl 的 `CreateDataPlaneSession`，得到 node 的地址 `session.endpoint` 与一张短期会话凭证（data-plane session credential）。
2. 向 `session.endpoint` 发请求，带上 `Authorization: Bearer` 头。

数据面服务的定义在 `kibotos.ctrl.v1` 里，但运行在 node 上。所有方法都要求 Workspace 处于 `AVAILABLE`。

## 申请会话凭证 {#session}

调用 `kibotos.ctrl.v1.DataPlaneSessionService/CreateDataPlaneSession`。这个方法没有能力名，从 `v0.1.0` 起总是可用。

### 请求字段 {#session-request}

| 字段 | 说明 |
|---|---|
| `metadata.command_id` | 幂等键（command ID）。相同的幂等键重发返回同一张凭证 |
| `workspace_id` | 目标 Workspace，必须处于 `AVAILABLE` |
| `requested_scopes` | 需要的权限范围，1 到 5 个、不重复，取值见 [scope](#scopes) |
| `requested_ttl` | 有效期，整秒，1 秒到 15 分钟。省略或为 0 时使用默认值 5 分钟。`lifetime` 为 `EXECUTION` 时不能给出 |
| `service_targets` | 申请 `DATA_PLANE_SCOPE_SERVICE_CONNECT` 时必填，其他情况不能出现。1 到 16 个精确、不重复的目标，见[桌面与服务连接](/integrate/native-api/desktop-services) |
| `expected_generation` | 可选。调用方认为的当前执行代（generation）；签发时核对，不一致返回 `failed_precondition` |
| `lifetime` | 有效期策略。缺省按 `requested_ttl`；`DATA_PLANE_SESSION_LIFETIME_EXECUTION` 表示绑定当前这一轮执行，见 [EXECUTION](#execution-lifetime) |

- `service_targets`、`expected_generation` 与 `lifetime` 都参与幂等比较：重发只会拿回原来那张凭证，不会签给更新的执行。
- Workspace 不是 `AVAILABLE`、执行代不一致或到期时间已到时，返回 `failed_precondition`。
- 申请的服务目标所需的能力，Workspace 使用的 Platform 不提供时，返回 `unimplemented`，`reason` 为 `CAPABILITY_UNAVAILABLE`。

### 响应字段 {#session-response}

| 字段 | 说明 |
|---|---|
| `session.session_id` | 会话 ID，不是机密，可以写进日志用于关联 |
| `session.workspace_id` | 目标 Workspace |
| `session.endpoint` | node 数据面的 HTTPS 地址，作为后续请求的 base URL |
| `session.scopes`、`session.service_targets` | 实际授予的范围与目标 |
| `session.created_at`、`session.expires_at` | 签发时间与到期时间 |
| `credential` | 凭证本身，一个不透明的字符串 |

::: danger
`credential` 是 bearer 凭证，持有它就能在有效期内以授予的范围访问这个 Workspace。按不透明字符串原样使用，只放在 `Authorization` 头里；日志、URL 与查询串里都不能出现它。
:::

### scope {#scopes}

| scope | 授予的访问 |
|---|---|
| `DATA_PLANE_SCOPE_FILE_READ` | `FilesystemService` 的 `Stat`、`ListDir`、`WatchDir`，以及 `GET /v1/files` |
| `DATA_PLANE_SCOPE_FILE_WRITE` | `FilesystemService` 的 `MakeDir`、`Move`、`Remove`，以及 `PUT /v1/files` |
| `DATA_PLANE_SCOPE_PROCESS` | `ProcessService` 的全部方法 |
| `DATA_PLANE_SCOPE_DESKTOP` | `DesktopService` 的全部方法 |
| `DATA_PLANE_SCOPE_SERVICE_CONNECT` | `ServiceConnectionService/Connect` 与 `GET /v1/service`，只对列出的目标有效 |

按需申请最小的范围。凭证的范围不足时，node 返回 `permission_denied`。

### 有效期 {#session-ttl}

- 缺省 5 分钟，`requested_ttl` 最长 15 分钟；`EXECUTION` 最长 1 小时。node 允许与 ctrl 有 30 秒的时钟偏差。
- 凭证到期只影响新建的 RPC，已经建立的流不会因此中断。
- 下面几种情况会中断正在进行的流：凭证被撤销、Workspace 停止或删除、Workspace 重新启动进入新的执行代、有人调用了 `RevokeWorkspaceDataPlane`。

### EXECUTION {#execution-lifetime}

`lifetime` 设为 `DATA_PLANE_SESSION_LIFETIME_EXECUTION` 时，凭证绑定 Workspace 当前这一轮执行：

- 必须同时给出 `expected_generation`，不能带 `requested_ttl`。
- 最长有效 1 小时；Workspace 的到期时间更早时，到期即止。
- 这一轮执行结束时，数据面立即拒绝这张凭证。1 小时的上限仍然限制泄露的凭证、被撤销的调用方与签名密钥的轮换，所以缓存它的调用方也要在到期之前续签。
- 需要服务端宣告能力名 `workspace.session.execution`。

### 缓存与续签 {#session-renewal}

缓存一张凭证供多个请求复用时：

- 已经用掉约 80% 的有效期之后（再减去最多 10% 的随机抖动）就重新申请，不要等到只剩几秒。node 允许 30 秒的时钟偏差，固定的小余量会在你以为凭证还有效时被拒绝。
- 每次续签用一个新的幂等键。用同一个幂等键只会拿回原来那张凭证；那张凭证过期之后，同一个幂等键返回 `failed_precondition`（`SESSION_EXPIRED`）。
- node 返回 `SESSION_EXPIRED` 或 `SESSION_REVOKED` 时，丢掉缓存的凭证，下一次请求重新申请，不要拿同一张凭证重试。
- 交互式会话比一张凭证活得久：输出流只在建立时鉴权一次，但每次按键的 `SendInput`、每次 `Resize` 与 `SendSignal` 都是新的 RPC，都要重新鉴权。在 `expires_at` 之前用新的幂等键申请一张凭证换上即可，不必重开输出流。
- 凭证是不透明字符串。同一个会话重发得到的字符串可能与上一次不同（例如服务端升级之后），这时两张都有效。

## 带凭证访问 node {#access-node}

- 请求发往 `session.endpoint`，带一个 `Authorization: Bearer` 头，值是 `credential`。只能有一个 `Authorization` 头。
- 数据面的 TLS 规则与 ctrl 不同：信任系统根证书加上 `server-ca.pem`，按标准规则校验主机名，不跟随重定向，不需要客户端证书。见[身份与认证](/integrate/native-api/authentication)。
- 流式方法需要 HTTP/2。

鉴权失败的错误：

| 错误码 | `reason` | 含义与处理 |
|---|---|---|
| `unauthenticated` | `UNAUTHENTICATED` | 没有凭证、凭证格式不对或校验不通过 |
| `unauthenticated` | `SESSION_EXPIRED` | 凭证已过期，重新申请 |
| `permission_denied` | `PERMISSION_DENIED` | 凭证的范围不包含这个操作 |
| `permission_denied` | `SESSION_REVOKED` | 凭证被撤销，或它所属的执行已经结束（Workspace 停止、删除、重新启动或撤销了数据面），重新申请 |
| `unavailable`（可重试） | `UNAVAILABLE` | guest 正在重启，或上一次撤销之后的清理还没完成，稍后用同一张凭证重试 |
| `failed_precondition` | `CAPABILITY_UNAVAILABLE` | Workspace 的 guest 不提供这个功能，常见于早于某个版本启动的 Workspace，重启 Workspace 后可用 |

## 数据面服务 {#services}

| 服务 | 方法 | 需要的 scope | 能力名 |
|---|---|---|---|
| `FilesystemService` | `Stat`、`ListDir`、`WatchDir`（服务端流） | `DATA_PLANE_SCOPE_FILE_READ` | `workspace.filesystem`；`WatchDir` 另需 `workspace.filesystem.watch_dir` |
| `FilesystemService` | `MakeDir`、`Move`、`Remove` | `DATA_PLANE_SCOPE_FILE_WRITE` | `workspace.filesystem` |
| HTTP `GET /v1/files` | | `DATA_PLANE_SCOPE_FILE_READ` | `workspace.filesystem` |
| HTTP `PUT /v1/files` | | `DATA_PLANE_SCOPE_FILE_WRITE` | `workspace.filesystem` |
| `ProcessService` | `Start`（服务端流）、`Attach`（服务端流）、`SendInput`、`CloseStdin`、`SendSignal`、`Resize` | `DATA_PLANE_SCOPE_PROCESS` | `workspace.process`；续传另需 `workspace.process.resume` |
| `DesktopService` | `Screenshot`、`PerformActions` | `DATA_PLANE_SCOPE_DESKTOP` | `workspace.desktop` |
| `ServiceConnectionService` | `Connect`（双向流） | `DATA_PLANE_SCOPE_SERVICE_CONNECT` | `workspace.service_connection` |
| HTTP `GET /v1/service` | | `DATA_PLANE_SCOPE_SERVICE_CONNECT` | `workspace.service_connection` |

### 文件系统 {#filesystem}

`FilesystemService` 只处理元数据与目录，文件内容经 [/v1/files](#files-http) 传输。

- **路径**：guest 中的绝对路径，最长 4096 字节，不能含 NUL。`/` 本身只能用于 `Stat`、`ListDir` 与 `WatchDir`。
- **`Stat`**：返回一个 `EntryInfo`，不跟随末尾的符号链接。
- **`ListDir`**：`depth` 是返回条目的最大相对深度，取 1 到 64，1 表示只列直接子项。结果按路径排序，不包含被列出的目录本身。条目超过 10000 个时整个请求以 `resource_exhausted` 失败，改用更小的 `depth` 或分目录列出。
- **`MakeDir`**：`mode` 只取权限位，0 表示 `0755`；缺少的父目录自动创建。目录已经存在时返回 `already_exists`，路径被非目录占用时返回 `failed_precondition`。
- **`Move`**：把 `source` 移到 `destination`，缺少的目标父目录自动创建。
- **`Remove`**：删除文件；目录连同其中的内容一起删除。路径不存在时返回 `not_found`。
- **写入失败**：写入的目录只读时返回不可重试的 `permission_denied`，以 root 写入也一样；文件系统空间或配额用尽时返回不可重试的 `resource_exhausted`。

`EntryInfo` 的字段：

| 字段 | 含义 |
|---|---|
| `path`、`name` | 规范化的绝对路径与条目名 |
| `type` | `ENTRY_TYPE_FILE`、`ENTRY_TYPE_DIRECTORY`、`ENTRY_TYPE_SYMLINK` 或 `ENTRY_TYPE_OTHER` |
| `size_bytes` | 只对普通文件有意义，其他类型为 0 |
| `mode` | 只含权限位 |
| `modified_at`、`uid`、`gid` | 修改时间与属主 |
| `symlink_target` | 符号链接的目标，只对符号链接出现 |

### 进程 {#process}

`ProcessService/Start` 启动一个进程并打开它的输出流。进程的生命周期由 guest 管理，不随 `Start` 或 `Attach` 的流结束：流断开后进程照常运行，可以再 `Attach`。

`StartRequest` 的字段：

| 字段 | 说明 |
|---|---|
| `argv` | 程序与参数，不经过 shell 解释；需要 shell 语法时写成 `["sh", "-c", "..."]`。各项不能含 NUL |
| `working_directory` | 工作目录。留空时在执行账号的 home 目录启动，例如 `/home/user` 或 `/root`；`environment` 里的 `HOME` 不改变它。目录不存在时返回 `not_found` |
| `environment` | 环境变量，替换同名的默认值。变量名不能为空、不能含 `=` 或 NUL |
| `timeout_millis` | 0 表示不限时。超时后进程被终止，`termination_reason` 为 `PROCESS_TERMINATION_REASON_TIMED_OUT` |
| `pipe` 或 `pty` | 二选一。`pipe.stdin` 为真时打开标准输入；`pty` 给出终端的 `rows` 与 `columns`，各取 1 到 65535 |
| `user` | 以哪个 guest 账号执行，见 [user 字段](#user) |

- 进程不继承 guest 自己的环境变量。默认环境只有 `PATH`（Template 可以设置）与执行账号的 `HOME`，PTY 模式另有 `TERM=xterm`。
- 流的第一条消息是 `attached`，给出 `pid`、`incarnation`、模式与各输出通道的位置。之后是 `output`（`channel` 为 `OUTPUT_STREAM_STDOUT`、`OUTPUT_STREAM_STDERR` 或 `OUTPUT_STREAM_PTY`，带 `offset` 与 `data`）、空闲时每 10 秒一条 `heartbeat`，进程退出后是 `exited`。
- `exited` 给出 `exit_code`、`signal`、`termination_reason`（`PROCESS_TERMINATION_REASON_EXITED`、`PROCESS_TERMINATION_REASON_SIGNALED` 或 `PROCESS_TERMINATION_REASON_TIMED_OUT`）与每个通道的 `final_offset`。
- 之后的调用用 `pid` 加 `incarnation` 指定进程，`incarnation` 防止 PID 被复用时误操作别的进程。
- `SendInput` 每次最多 64 KiB；`CloseStdin` 关闭标准输入；`SendSignal` 只接受 `PROCESS_SIGNAL_SIGTERM` 与 `PROCESS_SIGNAL_SIGKILL`；`Resize` 调整 PTY 的行列数。
- 进程退出后，对它的 `SendInput`、`CloseStdin`、`SendSignal` 与 `Resize` 返回 `failed_precondition`，`reason` 为 `CONFLICT`，`stage` 为 `USING_PROCESS`。进程的结果照常从输出流的 `exited` 送达，以它为准，不要把这个错误当作会话失败。
- 进程退出后，结果在 guest 里保留 5 分钟；这期间仍可以 `Attach`，先补发输出，再收到 `exited`。
- 每个输出订阅的速率上限是 4 MiB/s（突发 64 KiB），管道模式的 stdout 与 stderr 共用。调用方 5 秒没有读取时，这条流以 `resource_exhausted` 结束，进程不受影响，用 `Attach` 续上。
- 单条流式消息不超过 32 KiB。

### user 字段 {#user}

`FilesystemService` 的各请求与 `ProcessService/Start` 都有 `user` 字段，指定在 guest 中以哪个账号执行；`/v1/files` 用查询参数 `user` 表示同一件事。

- 留空使用 Template 声明的账号；`root` 明确使用 root；也可以写出 Template 声明的账号名。其他值返回 `invalid_argument`。
- Template 声明的账号在 guest 中不可用时，Workspace 照常启动，只有以这个账号执行的请求失败。不可用指账号不存在、uid 或 gid 为 0，或者没有 home 目录，通常是在 guest 中删除或改名了它。
  - 不指定 `user` 或指定该账号的请求返回 `failed_precondition`，`reason` 为 `CONFLICT`，不可重试，`message` 注明账号与原因。
  - `root` 照常可用，桌面不可用。
  - 以 `root` 恢复账号后重启 Workspace，默认账号与桌面随之恢复。

## guest 内的资源上限 {#guest-limits}

guest 为自己的程序与内核预留一部分任务数与内存，经数据面启动的进程（受管进程）共用其余部分。一个进程失控时停在上限，其他进程、文件操作、进程管理与停止照常可用。

**任务数**（每个进程、每个线程各算一个）：

- 全部受管进程合计能用的任务数，比内核上限少 `256 + 32 × CPU 数`；内核上限很小时，受管进程至少能用其中一半。
- 每个 `Start` 启动的进程连同它的后代，以及桌面，最多用这个总数的 3/4，其余留给别的进程。
- 一个进程的份额用满后，其中新的进程与线程创建失败（`EAGAIN`）；总数用满后，所有进程里都是这样，`Start` 返回可重试的 `resource_exhausted`。

**内存**：

- 全部受管进程合计能用的内存，比 guest 启动时的可用内存少一部分：内存的 1/16，在 64 MiB 与 256 MiB 之间。这部分留给 guest 程序与内核。
- 用满后内核结束其中占用内存最多的进程。进程长时间卡在内存上限、既不被 OOM 结束也没有进展时，guest 会主动结束其中最大的一个，见[内存饱和与处置](/integrate/native-api/observability#memory-saturation)。
- tmpfs（`/tmp`、`/run`、`/dev/shm`）里的数据占用内存，结束进程也释放不了。

**进程数**：一个 Workspace 同时至多 128 个受管进程，超出时 `Start` 返回可重试的 `resource_exhausted`。

**每次启动重写的文件**：guest 每次启动重写 `/etc/hostname`、`/etc/hosts` 与 `/etc/resolv.conf`。在 guest 中对它们的修改，包括加上的 immutable 或 append-only 属性，都不跨启动保留。

## 目录监视 {#watch-dir}

`FilesystemService/WatchDir` <Badge type="tip" text="v0.2.0 新增" /> 报告一个目录里条目的变化，调用方不必轮询。需要能力名 `workspace.filesystem.watch_dir`。

请求字段：`path`（要监视的目录，指向目录的符号链接会被跟随）、`include_entry`（让 `CREATE`、`WRITE`、`CHMOD` 事件带上条目的 `EntryInfo`）、`user`（执行账号必须能读取这个目录）。

用法：

1. 调 `WatchDir`，等到第一条消息 `started`。
2. 用 `ListDir` 取全量。要在 `started` 之后取：两者之间的变化可能既不在结果里，也没有事件。
3. 之后按事件更新。事件只说明哪个路径可能变了，要细节就 `Stat`，或在请求里设 `include_entry`。
4. 流以任何原因结束，从第 1 步重来。

`started` 之后、流结束之前，目录里的每一次变化至少产生一个事件；做不到时流以 `resource_exhausted` 结束。相邻的相同变化可能只报一次。空闲时每 10 秒一条 `heartbeat`。

| 事件 | 含义 | `path` |
|---|---|---|
| `CREATE` | 新建条目，或条目被移入 | 新条目 |
| `WRITE` | 文件内容被写 | 被写的文件 |
| `CHMOD` | 权限、属主、时间戳等属性变化 | 该条目 |
| `REMOVE` | 条目被删除 | 被删的条目 |
| `RENAME` | 条目被移出或改名 | 原来的路径 |

- 只看一层：子目录自身的新建、删除、改名照常报告，子目录里的变化不报告。
- `path` 是请求的目录加条目名。
- `include_entry` 只对 `CREATE`、`WRITE`、`CHMOD` 生效，条目已经不在时不带。

流不会以成功结束，结束原因如下：

| 原因 | 错误码 |
|---|---|
| 事件来不及送达：guest 队列满、guest 内核丢了事件，或调用方 5 秒没有读取 | `resource_exhausted` |
| 目录被删除、移走，或所在文件系统被卸载 | `not_found` |
| 凭证被撤销、Workspace 停止或删除 | `permission_denied`，`SESSION_REVOKED` |
| guest 停止或不可达 | `unavailable` |
| node 换用新的数据面进程，例如平台运营方升级了 node | `unavailable`，可以立即重新监视 |

限制：每个 Workspace 最多 64 条监视流，超出时新的请求返回 `resource_exhausted`；每条流每秒最多送出 1000 个事件。Workspace 的 guest 早于 `v0.2.0` 时返回 `failed_precondition`（`CAPABILITY_UNAVAILABLE`），重启 Workspace 后可用。

## 进程流续传 {#process-resume}

<Badge type="tip" text="v0.2.0 新增" /> 进程的输出流断开后可以续传：guest 为每个进程的每个输出通道保留最近 1 MiB 的输出，调用方重新 `Attach` 就能补上断开期间的输出，输入也可以安全地重发。需要能力名 `workspace.process.resume`。

1. 记下每个通道已经收到的位置：`ProcessOutputEvent` 的 `offset` 加上 `data` 的长度。
2. 流在 `attached` 之后以 `unavailable` 或连接中断结束时，用同一个 `pid` 与 `incarnation` 调 `Attach`，在 `resume_from` 里给出每个通道的位置（`channel` 与 `offset`）。没列出的通道从当前位置开始。
3. 新的 `attached` 在每个通道上给出 `start`：补发从这里开始，之后是实时输出，同一通道里连续。`start` 大于请求的位置时，中间的字节已经不在缓冲里，差值就是丢失的字节数。
4. `SendInput` 带上 `input_offset`，即这段输入在进程输入里的起始位置。重发时进程已经接受的部分被跳过，不会写两次。

- 旧的数据面进程结束时，HTTP/2 连接先收到 GOAWAY 再关闭。有的客户端库把这种关闭报成协议错误，例如 Go 的 Connect 客户端报 `invalid_argument: protocol error: incomplete envelope`，同样按连接中断续传。
- 成功的 `SendInput` 响应里的 `input_offset` 是进程此后已接受的输入字节数，也就是下一段输入的位置。`attached` 里的 `input_offset` 是续传那一刻的值。
- `resume_from` 的位置超过通道已产生的字节数时，`Attach` 返回 `invalid_argument`，原来的订阅不受影响。
- `input_offset` 大于进程已接受的字节数时返回 `failed_precondition`（`CONFLICT`），错误详情的 `input_offset` 是已接受的字节数，这次什么都不写。
- 进程退出后，在结果保留期内照样可以续传：先补发输出，再收到 `exited`。
- 补发的字节与实时输出一样受速率与缓冲窗口的限制。
- guest 里所有进程的缓冲合计不超过 16 MiB 与 guest 内存 1/16 中较小者。超出时整块释放其他进程的缓冲，先释放已退出的进程，再释放最久没有输出的进程。被释放的进程续传时，起点是它当时的位置。
- 续传时凭证已经过期的，先重新申请凭证再续传。
- Workspace 的 guest 早于 `v0.2.0` 时，`Attach` 忽略 `resume_from`，订阅从当前位置开始，`start` 等于 `offset`；带 `input_offset` 的 `SendInput` 返回 `unimplemented`（`UNSUPPORTED`）。重启 Workspace 后可用。

`kibo` 与 E2B 兼容网关会自动续传。

## 文件传输 /v1/files {#files-http}

文件内容通过数据面同一地址上的 HTTP 入口传输，不走 RPC：

```text
GET  https://node-a.example.com:18091/v1/files?path=/data/report.txt
PUT  https://node-a.example.com:18091/v1/files?path=/data/report.txt&mode=0644&create_only=true
```

地址的前半部分是 `session.endpoint`，上面的主机与端口只是示例。

### 参数 {#files-parameters}

| 查询参数 | 说明 |
|---|---|
| `path` | 必填。guest 中的绝对路径 |
| `mode` | 只用于 `PUT`：新文件的权限，八进制，只含权限位，默认 `0600` |
| `create_only` | 只用于 `PUT`：`true` 或 `1` 表示目标已存在则失败；`false`、`0` 或不带为覆盖 |
| `user` | 以哪个 guest 账号读写，规则见 [user 字段](#user) |

表外的参数、同一参数出现多次、`GET` 带 `mode` 或 `create_only`，以及 `mode`、`create_only` 取值不合法，都返回 400（`invalid_argument`），请求不会到达 guest。

### 行为 {#files-behavior}

- 只接受 `GET` 与 `PUT`，其他方法返回 405。
- `GET` 支持单段 `Range: bytes=…`，包括从末尾计数的形式，返回 200 或 206；多段 Range 被拒绝，无法满足的 Range 返回 416。`If-Range` 原样转给 guest。
- 响应头透传 `Content-Type`、`Content-Length`、`Content-Range`、`Accept-Ranges`、`ETag` 与 `Last-Modified`。`ETag` 的格式是 `"<大小>-<修改时间纳秒>"`。
- `PUT` 自动创建缺少的父目录。覆盖已有文件时，先写到目标旁边的临时文件，落盘后再替换目标；失败时目标保持不变。`create_only` 的目标已经存在时返回 409（`already_exists`）。
- `PUT` 在文件写入存储之后才返回，成功时为 200，响应体是 JSON：`{"path": …, "size_bytes": …, "sha256": …}`。建议核对大小与摘要。guest 边接收边写入存储，存储写得慢时请求体也接收得慢。
- 写入的目录只读时返回 403（`permission_denied`），以 root 写入也一样；文件系统空间或配额用尽时返回 413（`resource_exhausted`）。两者都不可重试，目标原有的文件保持不变。

### 上限 {#files-limits}

- 单次请求最多传输 1 GiB；更大的文件用多个 Range 请求分段读取。
- 速率上限 64 MiB/s，突发 1 MiB。
- 调用方 5 秒没有发送请求体、或没有读取响应时，请求被中断；没有发送请求体时返回 408。等 guest 读写文件的时间不计入。

### 错误映射 {#files-errors}

错误响应体是 JSON：`{"code": "<Connect 错误码>", "detail": <ErrorDetail 的 JSON>}`，`detail` 的字段名用 proto 原名（例如 `retryable`、`message`）。HTTP 状态按错误码映射，完整对照见 [/v1/files 的 HTTP 状态](/reference/errors#files-http)。

## 相关文档 {#related}

- [桌面与服务连接](/integrate/native-api/desktop-services)：`DesktopService`、`ServiceConnectionService` 与 `/v1/service`。
- [运行状况观测](/integrate/native-api/observability)：guest 是否回应、内存饱和与 guest 重启。
- [身份与认证](/integrate/native-api/authentication)：数据面与控制面的 TLS 区别。
- [错误码](/reference/errors)：错误码、`FailureReason` 与 HTTP 状态。
