---
title: kibo 命令参考
description: kibo v0.3.0 的全局参数、命令自带的通用参数、大小与时长写法、补全与 ID 前缀、JSON 输出、退出码、错误输出、本地文件读写规则与命令索引。
---

# kibo 命令参考

本页是 `kibo` v0.3.0 的参考资料：全局参数、各命令共用的参数、取值写法、JSON 输出格式、退出码、错误输出、读写本地文件的规则，以及面向接入方的命令索引。读者是写脚本或排查问题的接入开发者。命令的用法按主题分在[安装与连接](/integrate/kibo/setup)、[管理 Workspace](/integrate/kibo/workspaces)、[网络、Egress 与 Resolver](/integrate/kibo/network)、[Volume 与数据迁移](/integrate/kibo/storage)与[端口、公开 URL 与桌面](/integrate/kibo/services)。

::: tip 兼容范围
`kibo` 的参数与输出不在接口兼容承诺的范围内，版本之间可能直接改变，变化写在[变更记录](/releases/changelog)。需要长期稳定接口的程序请直接调用原生 API，见[兼容策略](/releases/compatibility)。
:::

## 全局参数 {#global-flags}

这些参数可以放在子命令之前或之后。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--endpoint` | context 中保存的地址 | 覆盖这一次调用的 ctrl 地址。未传时先看环境变量 `KIBO_ENDPOINT`，再用 context 中的值。身份、信任的 CA 与代理仍来自 context |
| `--json` | 关闭 | 输出 JSON envelope，业务结果在 `result` 字段，见 [JSON 输出](#json-output) |
| `--timeout` | `30s` | 发往 ctrl 的单次请求的时限。短命令连同开头的能力检查都在这个时限内完成；等待、流式与传输类命令用它限制其中的每一次请求，不限制整体。文件上传与下载本身不受它限制 |
| `-h`、`--help` | | 显示帮助 |

`kibo` 读取的环境变量：

| 变量 | 作用 |
|---|---|
| `KIBO_CONTEXT_DIR` | context 目录，必须是绝对路径。未设置时为 `$XDG_CONFIG_HOME/kibo/context` 或 `~/.config/kibo/context` |
| `KIBO_ENDPOINT` | 覆盖 ctrl 地址，优先级低于 `--endpoint` |
| `KIBO_NOVNC_DIR` | `workspace desktop view` 使用的 noVNC 目录，优先级低于 `--novnc-dir` |
| `HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 及其小写形式 | context 没有保存代理时使用的正向代理；访问 loopback 地址时不使用 |

## 命令自带的通用参数 {#command-flags}

下面这些参数只挂在用得到的命令上，必须写在子命令之后，例如 `kibo workspace delete "$workspace_id" --yes`。

| 参数 | 出现在 | 说明 |
|---|---|---|
| `--command-id` | 发送变更的命令 | 幂等键，未传时自动生成。同一个键加同样的输入重放不会重复执行，输入不同时以冲突拒绝。1 到 128 字节，以 ASCII 字母或数字开头，只含字母、数字、`.`、`_`、`/`、`-`。规则见 `kibo help command-ids` 与[管理 Workspace](/integrate/kibo/workspaces) |
| `-y`、`--yes` | `workspace delete`、`workspace stop --force`、`workspace file delete`、`volume delete`、`transfer delete`、`enrollment revoke`，以及平台运营方使用的回收、退役与宣告丢失命令 | 跳过确认。标准输入或标准输出不是终端时必须提供；`enrollment revoke` 总是需要它 |
| `-q`、`--quiet` | `workspace create`、`get`、`list`、`start`、`stop`、`delete`、`update`，`workspace network set`、`add`、`remove`，`volume create`、`get`、`list`、`resize`，`transfer export`、`get`，`exposure create`、`list`，`egress` 与 `resolver` 的 `create`、`get`、`list`、`update`、`delete`，`template list` | 只输出结果里的资源 ID，一行一个，例如 `ws=$(kibo workspace create --template kibotos-coding -q)` |
| `--wide` | `workspace get`、`list`，`volume get`、`list`，`egress get`、`list`，`resolver get`、`list`，`template list`，`version` | 加上默认省略的字段：各类 revision、执行代、完整 digest、labels 与能力名清单 |
| `-l`、`--label` | `workspace list`、`volume list`、`egress list`、`resolver list` | `key=value`，可重复，按 label 筛选 |
| `-L`、`--label-column` | 同上 | 可重复；把这个 label 显示成一列，列名是 key 最后一个 `/` 之后的部分 |
| `--all` | 同上 | 逐页读完全部结果；不带时只取一页，`-q` 会在标准错误提示还有下一页。不能与 `--page-token` 同时使用 |
| `--page-size`、`--page-token` | 列表命令 | 每页条数，最大 100，不传时由服务端决定；`--page-token` 取上一页 `Next:` 一行给出的值 |
| `--wait-timeout` | 需要等待服务端完成的命令 | 等待的总时间：`workspace create`、`start`、`stop`、`delete` 与 `transfer restore` 默认 `1h`，`transfer export`、`import` 默认 `2h`。等待结束不撤回命令 |
| `--no-wait` | `workspace create`、`start`、`stop`、`delete` | ctrl 受理即返回 |
| `--expected-revision` 等 | 带版本校验的写命令 | 提交时的期望版本，见[管理 Workspace](/integrate/kibo/workspaces) |

- `--quiet`、`--wide` 与 `--json` 两两互斥，同时给出时以退出码 `2` 结束。
- 等待超时或按 Ctrl-C 都不会撤回已提交的操作。结果未知时用同一个幂等键重放，或用 `kibo workspace command get` 查询，不要换一个幂等键重新提交。

## 大小、CPU 与时长的写法 {#value-formats}

- **容量与内存**写成数字加单位，单位一律按二进制：`K`、`M`、`G`、`T`、`P` 与 `Ki`、`KiB` 等写法等价，不区分大小写，`1G` 是 1073741824 字节；`B` 或没有单位表示字节。小数可以用，只要结果是整字节，例如 `1.5G`。
- `KB`、`MB`、`GB`、`TB`、`PB` 这类十进制写法在发送请求前被拒绝，错误信息提示改成 `G` 或 `GiB` 的写法。
- **CPU** 写成核数或毫核：`2`、`0.5`、`1500m`。结果必须是大于 0 的整毫核，`0.0001` 这样的值被拒绝而不是取整。
- **时长**参数（`--timeout`、`--wait-timeout`、`--expires-in`、`--ttl`、`--exec-timeout`）写成 `90s`、`20m`、`8h`、`1h30m` 这样的形式，单位最大到 `h`，没有 `d`。`--drain-seconds` 例外，是 `0` 到 `3600` 的整数秒。

## 补全与 ID 前缀 {#completion}

- `kibo completion bash`（或 `zsh`、`fish`、`powershell`）输出补全脚本，例如在 bash 中执行 `source <(kibo completion bash)`。
- Workspace、Volume、Template、node、Exposure、Egress 与 Resolver 的 ID 参数，以及 `--template`、`--volume`、`--workspace`、`--node`、`--egress`、`--resolver` 的值，补全时向 ctrl 读取第一页资源，最多等 3 秒；没有 context 或连不上 ctrl 时不给出补全。
- `--network`、`--expiration-action`、`--selection`、`--delivery`、`--button`、`--direction`、`--family`、`workspace list --state` 与 `workspace network set` 的 mode 补全为固定取值。
- Workspace 与 Volume 的 ID 形如 `ws-` 或 `vol-` 加 26 个小写字符。作为命令的第一个参数时可以只写唯一的开头部分（必须以 `ws-` 或 `vol-` 开头），例如 `kibo workspace get ws-01k6`：`kibo` 读取全部未删除的资源来匹配，没有匹配时退出码 `12`，有多个匹配时退出码 `2` 并列出候选。参数的值与已删除的资源要写完整 ID。
- 别名：`ws` 等同于 `workspace`；每个 `list` 都可以写成 `ls`，每个 `delete` 都可以写成 `rm`。

## JSON 输出 {#json-output}

加 `--json` 时，成功的结果以一个 JSON 对象写到标准输出，失败时同样格式的对象写到**标准错误**：

```bash
kibo --json workspace get "$workspace_id" | jq -r '.result.state'
kibo --json workspace list --all | jq -r '.result.workspaces[].workspace_id'
```

| 字段 | 说明 |
|---|---|
| `api_version` | 固定为 `kibo.kibotos.app/v0`（v0.3.0 起；此前是 `kibo.kibotos.dev/v0`） |
| `kind` | 结果类型，见下表 |
| `command_id` | 写命令使用的幂等键，可以直接用来重放或查询；只读命令没有这个字段。人读输出里同一个值显示为 `Command ID:` |
| `observed_at` | 生成这份输出的时间，UTC |
| `completeness` | `COMPLETE`、`PARTIAL`、`TRUNCATED` 或 `UNKNOWN`。除了 `COMPLETE`，退出码都不是 `0` |
| `result` | 业务结果；失败时为 `null` |
| `warnings` | 字符串数组，通常为空 |
| `error` | 成功时为 `null`；失败时是错误对象，见下文 |

`result` 的写法：

- 来自 API 对象的字段名与原生 API 一致，使用 snake_case。枚举保留完整名称，例如人读输出中的 `AVAILABLE` 在 JSON 中是 `WORKSPACE_STATE_AVAILABLE`。
- 按 protobuf 的 JSON 规则编码：64 位整数是字符串（例如 `"revision": "3"`），时间是 RFC 3339 字符串，取值为零或为空的字段省略。
- 有输出不代表命令成功，脚本要同时检查 `completeness`、`error` 与退出码。

常用的 `kind`：

| 命令 | `kind` |
|---|---|
| `workspace get`、`--no-wait` 的生命周期命令，以及网络、到期、Volume 绑定、labels、annotations 的修改 | `Workspace` |
| `workspace list` | `WorkspaceList` |
| 等待完成的 `workspace create`、`start`、`stop`、`delete` | `WorkspaceCommandResult`，见[等待与查询结果](/integrate/kibo/workspaces#wait) |
| `workspace stop --force --no-wait` | `WorkspaceStop` |
| `workspace update` | `WorkspaceUpdate` |
| `workspace command get`、`volume command get` | `WorkspaceCommand`、`VolumeCommand` |
| `workspace cleanup-status` | `WorkspaceCleanup` |
| `workspace file put`、`get`、`delete` | `FileWrite`、`FileRead`、`FileDelete` |
| `volume get`、`create`、`resize`、`delete`；`volume list` | `Volume`；`VolumeList` |
| `transfer export`、`get`、`delete`；`import`；`restore` | `Transfer`；`TransferImport`；`TransferRestore` |
| `exposure`、`egress`、`resolver` 的单个对象；列表 | `Exposure`、`Egress`、`Resolver`；`ExposureList`、`EgressList`、`ResolverList` |
| `template list`；`template get`（带 `--revision` 时） | `TemplateList`；`Template`（`TemplateRevision`） |
| `context enroll`、`renew`、`show` | `OperatorContext` |
| `enrollment create`、`revoke` | `EnrollmentGrant`、`EnrollmentRevocation` |
| `version`；`version --client` | `Version`；`ClientVersion` |
| `service http`、`service forward`、`desktop view` | `ServiceHTTP`、`ServiceForward`、`Desktop` |
| `desktop screenshot`；键鼠输入 | `DesktopScreenshot`；`DesktopInput` |

几类命令不输出单个 envelope：

- `workspace exec --json` 在标准输出逐行写 JSON 记录：`"type":"output"`（`sequence`、`stream`、`offset` 与 base64 编码的 `data`）、`"type":"gap"`（丢失的 `bytes`）与最后一条 `"type":"result"`。
- `workspace file watch --json` 逐行写 `"type":"started"` 与 `"type":"event"` 记录。
- `service http`、`service forward`、`desktop view` 启动后输出一个 envelope，然后保持运行直到 Ctrl-C。
- `workspace terminal` 不支持 `--json`；`file get` 与 `desktop screenshot` 输出到 `-`（标准输出）时也不支持。

错误对象的字段：

| 字段 | 说明 |
|---|---|
| `kind` | 错误类别，与退出码一一对应，见[退出码](#exit-codes) |
| `retryable` | 服务端是否认为可以重试 |
| `impact` | 这次失败造成了什么，例如 `no valid request was sent` |
| `next_action` | 建议的下一步 |
| `message` | 说明文字，只用于诊断，不要解析 |
| `connect_code` | 服务端返回的错误码，例如 `failed_precondition`、`unavailable` |
| `failure_reason`、`failure_stage` | 服务端给出的失败原因与阶段，例如 `FAILURE_REASON_RESOURCE_EXHAUSTED` |
| `operation_id` | 相关操作的标识，有时出现 |

脚本按退出码、`kind`、`connect_code` 与 `failure_reason` 判断，不要解析 `message`。服务端错误码的含义见[错误码](/reference/errors#native)。

## 退出码 {#exit-codes}

| 退出码 | `error.kind` | 含义 |
|---|---|---|
| `0` | | 成功。`--no-wait` 返回时对象可能仍在变化，需要再查询状态 |
| `2` | `invalid_input` | 参数或配置错误、需要确认而没有确认、本地对 ctrl 服务端证书的校验失败，以及服务端返回 `invalid_argument` |
| `10` | `unauthenticated` | 未认证，包括数据面会话凭证已过期 |
| `11` | `permission_denied` | 无权限，包括数据面会话凭证已被撤销 |
| `12` | `not_found` | 对象不存在 |
| `13` | `conflict` | 状态或版本冲突（`failed_precondition`、`aborted`、`already_exists`、`resource_exhausted`），包括同一个幂等键配了不同的输入 |
| `14` | `unsupported` | 服务端不支持：没有宣告命令需要的能力名，或返回 `unimplemented` |
| `15` | `unavailable` | 服务暂时不可用，可以重试。只出现在只读命令上；写命令遇到 `unavailable` 时退出 `18` |
| `16` | `canceled` | 取消或超时，服务端的操作仍在进行，例如 Transfer 的等待在 `--wait-timeout` 内没有结束 |
| `17` | `incomplete` | 结果不完整，例如 `workspace update` 只生效了一部分，或结果的 `completeness` 为 `PARTIAL` |
| `18` | `unknown` | 结果未知：不能确定服务端是否执行了操作，包括写命令遇到 `unavailable`、超时与等待中止。用同一个 `--command-id` 重放或查询 |
| `21` | `integrity_failure` | 完整性校验失败，例如上传后大小或 SHA-256 不符 |

- **写命令遇到 `unavailable`、超时或取消时退出码是 `18`。** 这时请求可能已经生效，`kibo` 不把它报成可以放心重试的 `15` 或 `16`；`--json` 的 `connect_code` 与 `retryable` 仍保留原始信息。用同一个 `--command-id` 和同样的参数重试。例外是 Transfer 的等待超时，命令确定仍在进行，退出码为 `16`。
- 缺少能力名时，命令在发出任何写请求之前以 `14` 结束。
- 数据面（文件、进程、桌面）返回的错误按同样的规则分类。

`workspace exec` 与 `workspace terminal` 例外，与 `ssh` 一致：

| 退出码 | 含义 |
|---|---|
| 远端进程的退出码 | 远端进程正常结束 |
| `128` 加信号编号 | 远端进程被信号终止 |
| `124` | 远端进程超过 `--exec-timeout` 被终止 |
| `255` | `kibo` 自身失败，例如找不到 Workspace、会话被撤销、连接中断后 30 秒内没能续上，或 `exec` 续上后有输出丢失。具体类别写在错误输出里 |

## 错误输出 {#error-output}

- 错误写到标准错误。人读输出只有 `Error:` 一行，服务端给出阶段与原因时附在括号里，例如 `(placing, resource exhausted)`；有针对性的下一步写在 `Hint:` 一行；写命令另有 `Command ID:` 一行。
- 错误类别、影响与是否可重试只出现在 `--json` 的 `error` 字段里。
- 拼错子命令或参数时，`Hint:` 给出最接近的写法，例如 `did you mean --template?`。
- 不影响结果的提示以 `warning:` 开头写到标准错误，例如身份续期推迟、注册密钥文件权限过宽、`network add` 遇到已有条目。它们不改变退出码。
- 会话凭证、Egress 口令与注册密钥不会出现在任何输出与错误信息中；错误信息里万一带出会话凭证，会被替换为 `[REDACTED]`。
- 命令行上出现 `--password` 或 `--token` 时，`kibo` 在解析任何子命令之前就以退出码 `2` 拒绝。

## 本地文件输入与输出 {#local-files}

### 读取注册密钥 {#read-enrollment-key}

适用于 `kibo context enroll --key-file`：

- 接受相对路径、绝对路径，以及指向普通文件的符号链接。FIFO、目录和其他特殊文件被拒绝。
- 文件对 group 或 other 可读时打印警告，仍然读取。源文件不会被修改。
- 内容必须是一个不含空白的 token，首尾空白被去掉。
- `--key-stdin`、`--key-fd` 读取同样的内容；三个参数互斥。

### 读取 Egress 口令与 CA 证书 {#read-egress-secrets}

适用于 `kibo egress create` 与 `update`：

- `--password-file` 与 `--password-stdin` 去掉末尾的一个换行（`\n` 或 `\r\n`），其余字符原样作为口令，可以含空格。口令 1 到 255 字节。
- 只给 `--username` 时在终端上不回显地询问口令；没有终端时必须用这两个参数之一。
- `--tls-ca-cert-file` 是 PEM 文件，至多 64 KiB。

### 上传的本地来源 {#upload-source}

适用于 `kibo workspace file put`：本地来源必须是普通文件，或 `-` 表示标准输入。普通文件按大小发送；标准输入边读边发。

### 写入下载的文件与截图 {#write-downloads}

适用于 `kibo workspace file get` 与 `kibo workspace desktop screenshot`：

- 新文件权限为 `0600`。覆盖已有的普通文件时保留原权限。`file get` 可以用 `--mode 0640` 等写法指定权限，范围 `0000` 到 `0777`。
- 先写到目标所在目录的临时文件，完整接收后再替换目标。传输失败时目标文件不变。
- 目标不能是符号链接或特殊文件。输出到 `-`（标准输出）时不能使用 `--mode` 与 `--json`，大小与 SHA-256 写到标准错误。

## 命令索引 {#command-index}

下面按命令组列出面向接入方的子命令。完整参数用 `kibo <命令> --help` 查看。

### workspace {#cmd-workspace}

`kibo workspace`，别名 `kibo ws`。

| 子命令 | 说明 |
|---|---|
| `create` | 创建 Workspace，默认等待它可用 |
| `get <workspace-id>` | 查看一个 Workspace |
| `list` | 列出 Workspace，可按状态、label、guest 是否回应筛选 |
| `start <workspace-id>` | 启动已停止或可恢复的 Workspace |
| `stop <workspace-id>` | 停止 Workspace；`--force` 为强制停止 |
| `delete <workspace-id>` | 删除 Workspace |
| `update <workspace-id>` | 修改 CPU、内存或可写层容量，下次启动生效 |
| `cleanup-status <workspace-id>` | 查看执行已经释放与仍然占用的部分 |
| `command get <workspace-id> <command-id>` | 按幂等键查询一条命令的状态与结果 |
| `network set <workspace-id> <mode>` | 整体替换网络策略 |
| `network add <workspace-id>` | 向网络策略添加条目、Egress 或 Resolver |
| `network remove <workspace-id>` | 从网络策略删除条目、Egress 或 Resolver |
| `volume bind <workspace-id>` | 为已停止的 Workspace 绑定、换绑 Volume，或修改挂载路径与随删开关 |
| `volume unbind <workspace-id>` | 解除已停止 Workspace 的 Volume 绑定 |
| `expiration get <workspace-id>` | 查看 Workspace 及其到期设置 |
| `expiration set <workspace-id>` | 设置到期时间与到期动作 |
| `expiration clear <workspace-id>` | 清除到期设置 |
| `labels set <workspace-id> <key=value>...`、`labels clear <workspace-id>` | 整体替换或清空 labels |
| `annotations set <workspace-id> <key=value>...`、`annotations clear <workspace-id>` | 整体替换或清空 annotations |
| `exec <workspace-id> -- <command> [args...]` | 在 Workspace 里执行命令 |
| `terminal <workspace-id> [-- argv...]` | 打开交互终端 |
| `file put <workspace-id> <local-path> <remote-path>` | 上传文件；本地路径为 `-` 时读标准输入 |
| `file get <workspace-id> <remote-path> <local-path>` | 下载文件；本地路径为 `-` 时写标准输出 |
| `file delete <workspace-id> <remote-path>` | 删除文件或目录 |
| `file watch <workspace-id> <remote-directory>` | 逐行打印目录里条目的变化 |
| `service http <workspace-id>` | 把 Workspace 里的 HTTP 服务代理到本机，供浏览器打开 |
| `service forward <workspace-id>` | 把 TCP 端口或受管 Unix socket 转发到本机端口 |
| `service echo <workspace-id>`、`service bridge <workspace-id>` | 验证服务连接：回显校验、本机 WebSocket 适配器与验证页面 |
| `desktop view <workspace-id>` | 在本机浏览器中查看与操作桌面 |
| `desktop screenshot <workspace-id> <local-path>` | 截取桌面画面，本地路径为 `-` 时写标准输出 |
| `desktop move`、`click`、`drag`、`scroll`、`key`、`type`、`paste` | 向桌面发送一次键鼠输入 |

### volume {#cmd-volume}

| 子命令 | 说明 |
|---|---|
| `create` | 创建一个不属于任何 Workspace 的 Volume |
| `get <volume-id>` | 查看一个 Volume |
| `list` | 列出 Volume |
| `resize <volume-id>` | 扩大一个没有挂载的 Volume |
| `delete <volume-id>` | 删除 Volume 及其数据 |
| `command get <volume-id> <command-id>` | 按幂等键查询 `create`、`delete`、`resize` 的结果 |
| `labels set`、`labels clear`、`annotations set`、`annotations clear` | 修改 Volume 的 labels 与 annotations |

### transfer {#cmd-transfer}

| 子命令 | 说明 |
|---|---|
| `export <workspace-id>` | 把已停止 Workspace 的 Volume 导出为 Transfer |
| `get <transfer-id>` | 查看 Transfer 与它的 manifest |
| `import <transfer-id>` | 从 Transfer 创建一个新的 Volume |
| `restore <transfer-id>` | 用导入得到的 Volume 创建并启动新的 Workspace |
| `delete <transfer-id>` | 立即删除 Transfer 的归档 |

### exposure {#cmd-exposure}

部署配置了 Exposure 域名时可用。

| 子命令 | 说明 |
|---|---|
| `create` | 把 Workspace 里的一个 HTTP 端口发布成公开的 `https://` 地址 |
| `get <exposure-id>` | 查看一个 Exposure |
| `list` | 列出 Exposure，可用 `--workspace` 筛选 |
| `revoke <exposure-id>` | 立即停止服务这个地址 |

### egress 与 resolver {#cmd-egress-resolver}

`kibo egress` 与 `kibo resolver` 的子命令相同：

| 子命令 | 说明 |
|---|---|
| `create` | 创建 Egress（SOCKS5 端点）或 Resolver（DNS 上游） |
| `get <egress-id>`、`get <resolver-id>` | 查看一个对象 |
| `list` | 列出对象 |
| `update <egress-id>`、`update <resolver-id>` | 整体替换对象的设置 |
| `delete <egress-id>`、`delete <resolver-id>` | 删除没有被引用的对象 |
| `labels set`、`labels clear`、`annotations set`、`annotations clear` | 修改 labels 与 annotations |

### template {#cmd-template}

| 子命令 | 说明 |
|---|---|
| `list` | 列出 Template，默认只列可选用的，`--selection any` 列出全部 |
| `get <template-id>` | 查看 Template 与它的默认 revision；`--revision` 查看指定的 revision |

### 连接与其他 {#cmd-setup}

| 命令 | 说明 |
|---|---|
| `context enroll` | 用注册密钥换取 Operator 身份并保存 context |
| `context renew` | 立即续期当前身份 |
| `context show` | 查看本机的 context，不联系 ctrl |
| `enrollment create --operator <id>` | 为另一份 Operator 身份签发注册密钥 |
| `enrollment revoke --operator <id> --yes` | 撤销一份 Operator 身份与它尚未使用的注册密钥 |
| `version` | 显示本机与 ctrl 的版本；`--client` 只显示本机，`--wide` 列出 ctrl 的能力名 |
| `completion` | 输出 shell 补全脚本 |
| `help`、`help command-ids` | 显示帮助；`command-ids` 说明幂等键、重试与版本校验的规则 |

### 平台运营方使用的命令 {#operator-commands}

`kibo` 还带有平台运营方管理部署用的命令：`kibo node`（`list`、`get`、`drain`、`cancel-drain`、`isolate`、`retire`、`overcommit`）、`kibo storage-pool`（`list`、`get`、`set-capacity`、`declare-lost`、`objects`）、`kibo platform`（`publish`、`list`、`get`、`approve`、`withdraw`、`set-default`）、`kibo artifact`（`reclaim`、`retain`）、`kibo template` 的 `publish`、`prepare`、`approve`、`disable`、`withdraw`、`set-default`，`kibo workspace move`、`kibo workspace move-layer` 与 `kibo volume move`，`workspace create` 与 `workspace start` 的 `--node`，`workspace list` 的 `--node` 与 `--instance`，以及 `enrollment create`、`enrollment revoke` 的 `--node` 与 `--data-plane-extra-host`。Operator 身份没有更细的角色，这些命令对任何已注册的身份都可用，而且作用于整个部署。本站不展开它们，执行前请与平台运营方约定；自定义 Template 的发布与批准要点见[自定义 Template](/templates/custom#publish)。

## 下一步 {#next-steps}

- [安装与连接](/integrate/kibo/setup)
- [管理 Workspace](/integrate/kibo/workspaces#wait)
- [错误码](/reference/errors)
- [能力名清单](/reference/capabilities)
- [限制与默认值](/reference/limits)
