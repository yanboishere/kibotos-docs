---
title: 管理 Workspace
description: 用 kibo 创建 Workspace 并等待结果，执行命令、打开终端、传输与监视文件，管理 labels、到期时间、资源与 Volume 绑定，以及用幂等键安全地重试。
---

# 管理 Workspace

本页说明怎样用 `kibo` 创建和使用 Workspace：创建参数与等待语义，执行命令、终端与文件，labels 与 annotations，停止、启动与删除，到期时间，调整资源，绑定 Volume，以及脚本怎样用幂等键安全地重试。读者是用 `kibo` 操作 Workspace 的接入开发者。

- 状态的含义与故障恢复见 [Workspace 生命周期](/guide/workspace-lifecycle)。
- 网络策略见[网络、Egress 与 Resolver](/integrate/kibo/network)，Volume 与数据迁移见 [Volume 与数据迁移](/integrate/kibo/storage)。
- 全局参数、JSON 输出与退出码见 [kibo 命令参考](/reference/kibo-cli#global-flags)。

## 创建 {#create}

```bash
template_id=kibotos-coding
workspace_id=$(kibo workspace create --template "$template_id" --cpu 2 --memory 4G --disk 20G -q)
kibo workspace get "$workspace_id"
```

`template_id` 换成 `kibo template list` 中实际存在的 Template ID。更多写法：

```bash
kibo workspace create --template "$template_id" --expires-in 8h --network public-internet
kibo workspace create --template "$template_id" --network public-internet --deny 0.0.0.0/0 --deny ::/0 --allow 203.0.113.0/24
kibo workspace create --template "$template_id" --label team=infra --annotation note='nightly build'
```

### 参数 {#create-flags}

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--template` | 必填 | Template ID |
| `--template-revision` | Template 当前的默认 revision | 精确的 revision。不传时使用当前默认 revision，并把它固定到这个 Workspace 上，见 [Template 与 Platform](/templates/overview) |
| `--cpu` | `1` | 核数或毫核：`2`、`0.5`、`1500m`。实例得到的 vCPU 数是毫核按千向上取整，`1.5` 得到 2 个、`0.5` 得到 1 个。单个实例能给多少 vCPU 由承载它的 node 在启动时判定 |
| `--memory` | `256MiB` | 内存，如 `1G`、`512MiB`。必须是 MiB 的整数倍且不小于 128 MiB。实例实际得到的内存与请求值相同 |
| `--disk` | 由 node 的存储配置决定 | 根文件系统可写层的容量，如 `20G`，必须是 MiB 的整数倍。这个值同时是调度时预留的磁盘容量。其中 1 MiB 由 node 留给写满后的下一次启动，guest 里看到的可用空间比它少 1 MiB |
| `--network` | `deny-all` | `deny-all` 或 `public-internet` |
| `--allow`、`--deny` | 无 | 目的地规则，只能配 `--network public-internet`，见[网络、Egress 与 Resolver](/integrate/kibo/network) |
| `--egress`、`--egress-destination` | 无 | 让这些目的地的 TCP 经调用方的 Egress 离开，只能配 `public-internet` |
| `--resolver`、`--resolver-path` | 无 | 把 guest 的 DNS 查询转给调用方的 Resolver，只能配 `public-internet` |
| `--expires-in`、`--expiration-action` | 不设到期；动作 `stop` | 见[到期](#expiration) |
| `--label`、`--annotation` | 无 | `key=value`，可重复，见 [labels 与 annotations](#labels-annotations) |
| `--capability` | 无 | `key=value`，可重复。要求承载这个 Workspace 的 node 宣告这项能力，不满足的 node 不会被选中。Template 也可能声明这类要求，两者对同一个 key 给出不同的值时创建失败。可用的键值取决于部署配置，可向平台运营方确认 |
| `--volume`、`--mount-path`、`--delete-with-workspace`、`--no-volume` | 新建 Volume 挂在 `/data` | 见下节 |
| `--wait-timeout` | `1h` | 等待完成的总时间，见[等待与查询结果](#wait) |
| `--no-wait` | 关闭 | ctrl 受理后立即返回 |
| `--command-id` | 自动生成 | 幂等键，见[幂等键与版本](#command-ids) |
| `-q` | 关闭 | 只输出 Workspace ID |

- 大小写法见 [kibo 命令参考](/reference/kibo-cli)：单位一律按二进制，`1G` 是 1 GiB，`GB` 这类十进制写法被拒绝。
- 写法错误、互斥的参数组合、非法的 `--network` 与不规范的地址条目都在发送请求前被拒绝，退出码 `2`。
- 带 `--allow`、`--deny`、`--egress`、`--resolver`、`--label`、`--annotation` 时，ctrl 还要宣告对应的能力，否则以退出码 `14` 结束，不会创建一个丢了这些设置的 Workspace。
- 选中的 revision 不可选用（未批准、已停用或已撤回）时，创建以 `failed_precondition` 失败，退出码 `13`。
- 把创建固定到某一台 node 的 `--node` 是平台运营方使用的参数，本站不展开。

### Volume 参数 {#volume-flags}

每个 Workspace 默认带一个新建的 Volume，挂在 `/data`，并标记为随 Workspace 删除。只有 Volume 的挂载路径承诺在停止、启动之间保留数据。

| 写法 | 效果 |
|---|---|
| 不传 | 新建一个 Volume 挂在 `/data`，删除 Workspace 时一起删除 |
| `--mount-path /srv/data` | 新建的 Volume 挂在这个路径 |
| `--volume "$volume_id"` | 绑定一个已有的 Volume。默认在删除 Workspace 时只解除绑定，保留 Volume |
| `--delete-with-workspace` 或 `--delete-with-workspace=false` | 显式决定删除 Workspace 时是否连 Volume 一起删除。新建的 Volume 默认删除，`--volume` 绑定的默认保留 |
| `--no-volume` | 不绑定 Volume。这样的 Workspace 没有承诺持久的路径 |

- `--volume` 与 `--no-volume` 互斥，`--no-volume` 也不能与 `--mount-path`、`--delete-with-workspace` 同时使用。
- 挂载路径必须是规范的绝对路径，不能是 `/`，不能位于 `/proc`、`/sys`、`/dev`、`/run`、`/tmp` 本身或其下，最长 4096 字节。
- `--volume` 指定的 Volume 必须处于 `AVAILABLE`，并且没有被其他未删除的 Workspace 绑定。已有的 Volume 用 `kibo volume create` 或 `kibo transfer import` 创建，见 [Volume 与数据迁移](/integrate/kibo/storage)。
- 每次启动时，Volume 的顶层目录交给 Template 声明的账号（同样的 uid 与 gid），里面的文件归各自的创建者。Template 没有声明账号时属于 root。
- 「随 Workspace 删除」是绑定的属性，不是 Volume 的种类。Workspace 停止后可以用 `kibo workspace volume bind` 修改它，见[绑定、换绑与解绑 Volume](#volume-binding)。

根文件系统的其他位置写在属于这个 Workspace 的可写层里，停止后只是尽力保留，可能重建；`/tmp`、`/run` 与内存、进程都不保留。承诺保留的数据要写进 Volume，见[数据持久性与保护](/security/data)。

## 等待与查询结果 {#wait}

`workspace create`、`start`、`stop`、`delete` 默认在 ctrl 受理命令后持续查询这条命令的结果，直到 Workspace 变为 `AVAILABLE`、`STOPPED` 或 `DELETED`。它们不会重复发送同一条命令。

- **进度。** 在终端里运行时，标准错误上有一行随状态刷新的进度，例如 `Creating ws-01k6…: CREATING, 12s (Ctrl-C stops waiting, not the command)`。不在终端里时只在开始等待时输出一行。加 `--json` 或 `-q` 时不输出进度。
- **时限。** `--wait-timeout` 限制总等待时间，默认 `1h`；全局参数 `--timeout` 限制每一次请求，默认 `30s`。
- **只提交不等待。** `--no-wait` 在 ctrl 受理后立即返回，此时 Workspace 可能还在 `CREATING`、`STARTING`、`STOPPING` 或 `DELETING`。执行依赖当前状态的操作前，先用 `kibo workspace get` 再查一次。
- **等待结束不撤回命令。** 等待超时、按 Ctrl-C 或 `kibo` 与 ctrl 断开，都不会取消 ctrl 已经受理的命令。此时退出码为 `18`，错误信息包含 Workspace ID、命令 ID、最后一次看到的命令状态，以及查询结果的命令 `kibo workspace command get`。
- **受理没有应答。** `create` 与 `start` 提交后没有收到应答时，`kibo` 用同样的命令 ID 和输入重新提交，最多共提交三次；`stop` 与 `delete` 只提交一次。仍然拿不到结果时以退出码 `18` 结束，并给出这个命令 ID。用同一个 `--command-id` 和同样的参数重跑同一条命令即可接着拿到结果，**不要换一个命令 ID 重新提交**，否则可能创建出第二个 Workspace。
- **命令失败。** 命令执行完但失败时，错误信息形如 `Workspace ws-01k6…: create failed: …`，括号里是失败的阶段与原因，退出码按失败类别给出。没有 node 能容纳这个 Workspace（`resource exhausted`）时，提示改小 `--cpu`、`--memory`、`--disk`，或对已有的 Workspace 用 `kibo workspace update` 调小后再启动。

等待成功时，人读输出先给出命令完成时的 Workspace；这之后状态又变了时多一行 `Now`；`create` 与 `start` 完成且 Workspace 可用时，`Next:` 一行给出打开终端的命令。JSON 输出的 `kind` 为 `WorkspaceCommandResult`：

| 字段 | 含义 |
|---|---|
| `result.workspace_id` | Workspace ID，与 `--no-wait` 输出中的位置相同 |
| `result.command_result` | 命令完成时的 Workspace |
| `result.current_workspace` | 命令完成后再查询一次得到的当前状态。这次查询失败时为 `null`，原因在 `result.current_error`，不影响命令本身的成功 |
| `result.durability` | 只有 `stop` 有：停止前的写入是否已确认落盘，`STOP_DURABILITY_CONFIRMED` 或 `STOP_DURABILITY_UNCONFIRMED` |

`--no-wait` 时 JSON 输出的 `kind` 为 `Workspace`，ID 同样在 `result.workspace_id`；`stop --force --no-wait` 的 `kind` 为 `WorkspaceStop`，`result` 中有 `workspace` 与 `durability`。

脚本可以只提交、稍后再查：

```bash
workspace_id=$(kibo workspace create --template "$template_id" --command-id nightly-2026-11-06 --no-wait -q)
kibo --json workspace command get "$workspace_id" nightly-2026-11-06 | jq -r '.result.status'
```

`status` 为 `WORKSPACE_COMMAND_STATUS_PROCESSING` 时命令仍在执行，为 `WORKSPACE_COMMAND_STATUS_COMPLETED` 时已结束，结果在 `error` 或对应的结果字段里。

## 查看与列出 {#get-list}

### 查看 {#get}

```bash
kibo workspace get "$workspace_id"
kibo workspace get "$workspace_id" --wide
```

| 行 | 内容 |
|---|---|
| 标题 | Workspace ID 与状态 |
| `Template` | Template ID 与缩短的 revision |
| `CPU`、`Memory` | 请求的 CPU 与内存 |
| `Disk` | 可写层的容量。可写层还没创建时写明 `created at first start`；请求值与实际容量不同时两者都显示 |
| `Volume` | 绑定的 Volume 与挂载路径，随 Workspace 删除时附 `deleted with the Workspace`；没有 Volume 时为 `none; no path survives a stop` |
| `Network` 及其后几行 | 网络策略与生效情况，见[网络、Egress 与 Resolver](/integrate/kibo/network) |
| `Expires` | 到期时间与到期动作，没有时为 `never` |
| `Requires` | 对 node 的能力要求，没有时省略 |
| `Guest`、`Guest memory`、`Guest memory kills` | guest 的回应情况与内存状况，见[guest 不再回应的 Workspace](#guest-unresponsive) |
| `Node` | 正在执行它的 node；没有执行时为 `-` |
| `Created` | 创建时间 |
| `Labels`、`Annotations` | 每行一个条目，为空时省略 |
| `Failure` 一节 | 失败时的阶段、原因、是否可重试与说明 |

`--wide` 另外显示完整的 Template revision、当前 Instance、`Persistence` 一节（承诺保留的路径，以及 Volume、可写层与不保留部分的可用性、延续情况与重建原因），以及 `Revisions` 一节：`Generation`（执行代）、`Resources`、`Volume binding`、`Network policy`、`Expiration`、`Expiration command`、`Labels`、`Annotations` 各自的版本与更新时间。JSON 输出总是包含全部字段。

### 列表筛选与翻页 {#list}

```bash
kibo workspace list
kibo workspace list --state AVAILABLE --state STOPPED --label team=infra
kibo workspace list --include-deleted
kibo workspace list -L team --wide
```

- 默认不显示已删除的 Workspace。`--include-deleted` 显示全部；`--state` 按状态筛选，可重复，不区分大小写，取值 `CREATING`、`AVAILABLE`、`STOPPING`、`STOPPED`、`STARTING`、`DELETING`、`DELETED`、`FAILED`、`UNKNOWN`。两者互斥。
- `-l`、`--label key=value` 按 label 筛选，可重复，见[按 label 筛选](#label-selector)。
- 表格列是 `WORKSPACE`、`STATE`、`TEMPLATE`、`CPU`、`MEMORY`、`DISK`、`EXPIRES`、`AGE`；`--wide` 加上 `GEN`、`TEMPLATE REVISION`、`LABELS`；`-L key` 把一个 label 显示成单独的一列。失败的 Workspace 在表格下的 `FAILURES` 一节说明原因。
- 每次只取一页，页大小由服务端决定，`--page-size` 最大可设到 100。还有下一页时，摘要写明只是这一页，下面一行 `Next:` 给出取下一页的完整命令。
- `--all` 逐页读完全部结果，不能与 `--page-token` 同时使用。逐页读取不是同一时刻的快照，期间新建或删除的 Workspace 可能出现也可能不出现。
- `-q` 只输出这一页的 ID 时，标准错误会提示还有下一页。脚本要拿到全部 ID，用 `-q --all`。
- 按 node 或 Instance 列出（`--node`、`--instance`）是平台运营方使用的参数，本站不展开。

### guest 不再回应的 Workspace {#guest-unresponsive}

```bash
kibo workspace list --guest-unresponsive
```

只列出 guest 已不再回应其 node 的 Workspace，输出末尾的 `GUEST NOT RESPONDING` 一节给出每个的起始时间与最近一次错误。需要服务端宣告 `workspace.guest_observation`。

`kibo workspace get` 中三行显示同一份观测：

| 行 | 取值 |
|---|---|
| `Guest` | `responding` 或 `not responding since …`（括号里是最近一次错误）。guest 在这次执行里自己复位过时附 `restarted N time(s), last reset …`，末尾是观测时间 |
| `Guest memory` | `normal`、`saturated at the memory limit since …` 或 `unknown`（Platform、node 早于这项上报，或 guest 不再回应） |
| `Guest memory kills` | guest 因内存饱和杀过进程时出现：次数、最近一次被杀的进程（进程名、pid、常驻内存）、时间与判定依据 |

- 这些是观测，不是状态：guest 不再回应或内存饱和时 Workspace 仍是 `AVAILABLE`，到期回收也不看它们。guest 可能自己恢复。
- 一直不恢复时，用 `kibo workspace stop --force` 收回，再 `start`，见[强制停止](#force-stop)。
- 判定规则与 guest 杀进程的条件见[运行状况观测](/integrate/native-api/observability#guest-observation)与[内存饱和](/integrate/native-api/observability#memory-saturation)；guest 自己重启的情形见 [guest 自己重启或关机](/integrate/native-api/observability#guest-reboot)。

## 执行命令 {#exec}

```bash
kibo workspace exec "$workspace_id" -- uname -a
kibo workspace exec "$workspace_id" -w /data -e DEBUG=1 -- sh -c 'make test'
tar czf - src | kibo workspace exec -i "$workspace_id" -- tar xzf - -C /data
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `-w`、`--working-directory` | 执行账号的 home | 命令的工作目录。home 不是承诺保留数据的路径，需要在 Volume 里执行时传 `-w /data` |
| `-e`、`--env` | 无 | `KEY=VALUE`，可重复，值可以为空 |
| `-i`、`--stdin` | 关闭 | 把本地标准输入转发给远端进程，读到结尾时关闭远端的标准输入 |
| `--exec-timeout` | 不限时 | 远端进程运行超过这个时长后被终止，例如 `10m` |
| `--user` | Template 声明的账号 | 见[执行账号](#user) |

- 命令不经过 shell 解释，需要 shell 语法时写 `sh -c '...'`。
- 远端进程只得到 `PATH`（Template 声明的值，没有声明时为 `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`）与执行账号的 `HOME`，再加上 `-e` 给出的变量；镜像里的 `ENV` 与 shell 初始化文件不生效。
- 运行时间很长的命令不受凭证有效期影响，`kibo` 在到期前自动换新。

退出码与 `ssh` 一致：

| 退出码 | 含义 |
|---|---|
| 远端进程的退出码 | 远端进程正常结束 |
| `128` 加信号编号 | 远端进程被信号终止 |
| `124` | 远端进程超过 `--exec-timeout` 被终止 |
| `255` | `kibo` 自身失败，例如找不到 Workspace、会话被撤销、连接中断后 30 秒内没能续上，或续上后有输出丢失。具体类别写在错误输出里 |

与 node 的连接断开时，`kibo` 自动续上，不重新运行命令：断开期间的输出补上，没送达的输入按位置重发，不会重复。最多重试 30 秒，续不上时以 `255` 退出。

- 断开太久、某个输出通道超过远端保留的 1 MiB 时，丢失的字节补不回来。`kibo` 在标准错误写明哪个通道丢了多少字节，继续接收到远端结束，然后以 `255` 退出，错误信息里带远端的退出状态。
- 续传的机制见[进程流续传](/integrate/native-api/data-plane#process-resume)。

加 `--json` 时，标准输出是逐行的 JSON 记录而不是 envelope：`"type":"output"` 记录带 `sequence`、`stream`（`OUTPUT_STREAM_STDOUT` 或 `OUTPUT_STREAM_STDERR`）、`offset` 与 base64 编码的 `data`；`"type":"gap"` 记录带丢失的 `bytes`；最后一条 `"type":"result"` 记录带远端进程的结束信息。`kibo` 自身失败时，错误 envelope 写到标准错误。

## 终端 {#terminal}

```bash
kibo workspace terminal "$workspace_id"
kibo workspace terminal "$workspace_id" -- /bin/bash -l
```

- 不给命令时运行 Template 声明的 shell，没有声明时为 `/bin/sh`。远端得到 `TERM=xterm`。
- 本地的标准输入与标准输出都必须是终端，不支持 `--json`。
- 初始窗口大小取本地终端的大小，本地窗口改变大小时同步给远端。`--rows` 与 `--columns` 显式指定初始大小，两者要一起给出。
- `--working-directory` 指定起始目录（这个命令没有 `-w` 简写），`--user` 指定账号。
- 退出码是远端 shell 的退出码。连接断开时与 `exec` 一样自动续上；有输出丢失时在终端上提示后继续，退出码仍是远端的。
- `kibo` 退出时（包括本地终端窗口被关闭）结束远端的这个进程。需要在断开后继续运行的任务，用 `exec` 在 Volume 里启动并把输出写进文件。

## 文件 {#files}

### 上传 {#file-put}

```bash
kibo workspace file put "$workspace_id" ./app.tar.gz /data/app.tar.gz
echo hello | kibo workspace file put "$workspace_id" - /data/hello.txt
```

- 本地来源是普通文件，或 `-` 表示标准输入。
- `--mode` 设置远端新建文件的权限，八进制，默认 `0600`；`--create-only` 在远端文件已存在时失败，不覆盖。
- 上传边传边计算 SHA-256，并与 Workspace 一侧返回的 `size_bytes`、`sha256` 核对，不一致时以退出码 `21` 结束。成功时输出远端路径、大小与 SHA-256。
- 写入的目录只读时返回 `permission_denied`，空间或配额用尽时返回 `resource_exhausted`，两者都不可重试，远端原有的文件保持不变。

### 下载 {#file-get}

```bash
kibo workspace file get "$workspace_id" /data/report.txt ./report.txt
kibo workspace file get "$workspace_id" /data/report.txt - | less
```

- 先写到目标旁边的临时文件，字节数与 `Content-Length` 一致后再替换目标。传输失败时目标文件不变。
- 新文件的权限为 `0600`，覆盖已有的普通文件时保留原权限；`--mode 0640` 等写法指定权限。目标不能是符号链接或特殊文件。
- 目标为 `-` 时内容写到标准输出，大小与 SHA-256 写到标准错误；这时不能用 `--json` 或 `--mode`。

### 删除 {#file-delete}

```bash
kibo workspace file delete "$workspace_id" /data/tmp-output --yes
```

删除 guest 中的文件或目录，目录连同其中的全部内容一起删除。命令先请求确认，不在终端里运行时必须加 `--yes`。

### 监视目录 {#file-watch}

```bash
kibo workspace file watch "$workspace_id" /data
```

- 每次目录里的条目变化打印一行：`CREATE`、`WRITE`、`CHMOD`、`REMOVE` 或 `RENAME`，然后是条目的路径。子目录里的变化不报告，连续的几次变化可能合并成一次。
- 按 Ctrl-C 结束，退出码 `0`。目录被删除或移走、Workspace 停止、事件来不及送达时，监视以失败结束，此后的变化不再报告。
- `--entry` 让每条事件带上条目的元数据。加 `--json` 时逐行输出 `"type":"started"` 与 `"type":"event"` 记录。
- 需要服务端宣告 `workspace.filesystem.watch_dir`。每个 Workspace 同时存在的监视有上限，见[目录监视](/integrate/native-api/data-plane#watch-dir)。

### 传输限制 {#transfer-limits}

- 上传与下载不受全局 `--timeout` 限制，传多久都可以；`--timeout` 只限制传输前发往 ctrl 的请求。连续一分钟没有收发任何数据时，传输以失败结束。
- 数据面每次文件请求最多传输 1 GiB，速率上限 64 MiB/s。`kibo` 每个文件只发一次请求，所以超过 1 GiB 的文件以 `resource_exhausted` 失败（退出码 `13`）。更大的数据用 `exec` 流式传输，例如上文的 `tar czf - src | kibo workspace exec -i …`；下载时把远端 `tar` 的标准输出重定向到本地文件。
- 文件端点的完整规则见 [/v1/files](/integrate/native-api/data-plane#files-http)。

### 执行账号 {#user}

`exec`、`terminal` 与 `file put`、`get`、`delete`、`watch` 都接受 `--user`，指定在 guest 中以哪个账号执行：

| 取值 | 结果 |
|---|---|
| 不传 | Template 声明的账号；Template 没有声明时为 root |
| 声明的账号名 | 同上 |
| `root` | root |
| 其他名字 | 以 `invalid_argument` 拒绝 |

- 内置的 `kibotos-coding`、`kibotos-desktop`、`kibotos-memoh` 声明了账号 `user`（uid、gid 1000），它有免密 `sudo`；`kibotos-minimal` 没有声明账号，默认以 root 执行。见[内置 Template](/templates/builtin)。
- 声明的账号在 guest 中不可用时（被删除、改名，或 uid、gid 变成 0、没有 home），Workspace 照常运行，不指定 `--user` 或指定该账号的请求以 `failed_precondition` 失败；`--user root` 照常可用，可以用它修复。

## labels 与 annotations {#labels-annotations}

Workspace、Volume、Egress 与 Resolver 各有两份调用方自己的键值数据：

| 字段 | 可筛选 | 用途 |
|---|---|---|
| labels | 是 | 分组与查找资源，key 与 value 受字符规则限制 |
| annotations | 否 | 原样存取的任意文本 |

两者对所有能读这个资源的调用方可见，**不要放 token、密钥或由它们推出的值**。字符规则与大小上限由 ctrl 检查，违反时返回 `invalid_argument` 并指出字段与 key，见[限制与默认值](/reference/limits)。

### 创建时给出 {#labels-on-create}

```bash
kibo workspace create --template "$template_id" --label team=infra --annotation note='nightly build'
kibo volume create --capacity 10G --label team=infra
```

- `--label` 与 `--annotation` 都可重复，格式 `key=value`。只在第一个 `=` 处切分，所以 value 可以含 `=`；`key=` 表示值为空。
- 同一个 key 给出两次时在发请求前就被拒绝。
- 服务端没有宣告 `workspace.labels`（或 `workspace.annotations`、`volume.labels`、`volume.annotations`）时，带这些参数的命令以退出码 `14` 失败，不会创建一个丢了字段的资源。

### 按 label 筛选 {#label-selector}

```bash
kibo workspace list --label team=infra --label tier=gold
kibo volume list --include-deleted -l team=infra
```

- 每个条目要求 label 存在且值完全相等，多个条目同时满足。
- 可以与 `--state`、`--include-deleted` 和翻页组合，下一页的提示里带着同样的筛选条件。annotations 不参与筛选。

### 修改 {#labels-update}

```bash
kibo workspace labels set "$workspace_id" team=infra tier=gold
kibo workspace labels clear "$workspace_id"
kibo workspace annotations set "$workspace_id" note='nightly build'
kibo volume labels set "$volume_id" team=infra
kibo egress labels set "$egress_id" team=infra
kibo resolver annotations clear "$resolver_id"
```

- `set` 用给出的 `key=value` 整体替换，没写到的 key 被删除，不做合并。`clear` 删除全部。
- labels 与 annotations 各有自己的版本（`labels_revision`、`annotations_revision`），互不影响，也不影响资源的其他版本。不传 `--expected-revision` 时 `kibo` 先读取当前版本再提交；提交时版本已变化则返回冲突（退出码 `13`），不自动重试。
- 提交与当前完全相同的内容成功，版本不变。已删除的资源返回 `failed_precondition`。

### 输出 {#labels-output}

- `get` 的输出有 `Labels` 与 `Annotations` 两项，每行一个条目，为空时省略；两个版本在 `--wide` 的 `Revisions` 一节。含不可打印字符的 annotation 值加引号显示。
- `list` 的表格默认不显示 labels，`--wide` 加上 `LABELS` 一列。`-L key`（可重复）把这个 label 显示成单独的一列，列名是 key 最后一个 `/` 之后的部分，例如 `-L m.e2b.kibotos.app/bot_id` 加一列 `BOT_ID`；没有这个 label 的行显示 `-`。
- JSON 输出中对应 `labels`、`annotations`、`labels_revision`、`annotations_revision`，为空的 map 不输出。

## 停止、启动与删除 {#stop-start-delete}

```bash
kibo workspace stop "$workspace_id"
kibo workspace start "$workspace_id"
kibo workspace delete "$workspace_id" --yes
```

三条命令默认等待完成，可加 `--no-wait`，等待语义见[等待与查询结果](#wait)。

### 停止 {#stop}

- `stop` 先关闭这个 Workspace 的数据面，等待 guest 停止写入并同步文件系统，再停止实例、释放资源。Volume 与可写层保留，内存和进程不保留。正在运行的 `exec`、终端、文件传输与服务连接都会结束。
- 应用程序已经交给内核的写入会被同步；仍在应用程序自己缓冲区中的数据，需要应用自己在停止前 flush。
- 停止完成后 `Durability` 一行（JSON 的 `result.durability`）说明写入是否已确认落盘。KiboVM 后端还要把每块可写盘刷到存储设备，有一块没有刷完时为 `STOP_DURABILITY_UNCONFIRMED`，Workspace 照常停止。
- 同步失败或结果未知时，`stop` 不会改为强制销毁实例。用命令 ID 查询结果，必要时用强制停止。
- Workspace 的全部公开 URL（Exposure）随停止撤销，见[端口、公开 URL 与桌面](/integrate/kibo/services)。

### 强制停止 {#force-stop}

`kibo workspace stop "$workspace_id" --force` 用于正常停止完成不了的情况，包括 Workspace 停在 `FAILED`、仍持有实例的情况，不论是停止失败、VMM 意外退出还是别的操作失败：

- 它不等 guest 停止写入，只请 guest 做一次短时间的同步，然后停止实例、释放资源。Workspace 进入 `STOPPED`，Volume 与可写层都保留，可以再次 `start`。
- 同步不保证覆盖最后的写入，结果显示 `not confirmed on disk`，JSON 的 `durability` 为 `STOP_DURABILITY_UNCONFIRMED`。下次启动时文件系统靠日志恢复一致，效果等同一次断电。
- 实例的 VMM 已经退出时没有可停的机器，强制停止直接释放实例仍占用的 Volume、网络与可写层挂载，同样进入 `STOPPED`。在此之前 `start` 会被拒绝：旧实例还可能占着存储。
- 正常停止仍在处理时，强制停止取代它，原命令以 `CANCELLED` 结束。
- `FAILED` 且已经不持有执行的 Workspace 不接受强制停止，直接 `start`。开始过删除的 Workspace 不接受强制停止，也不接受 `start` 与配置修改，再次执行 `delete` 完成删除。
- 命令先请求确认，不在终端里运行时必须加 `--yes`。需要服务端宣告 `workspace.stop.force`。正常停止与到期停止失败时，服务端不会自动改为强制停止。

完整的接受条件见 [Workspace](/integrate/native-api/workspaces#force-stop)。

### 启动 {#start}

- `start` 创建新的实例，不恢复之前的进程和内存。Volume 重新挂载，可写层在可用时继续使用。
- 它接受 `STOPPED` 的 Workspace，也接受 `FAILED`、已经不持有执行、没有开始过删除的 Workspace，不论失败发生在创建、启动、停止还是别的操作里。
- 创建在建好实例之前失败的 Workspace 也可以 `start`；失败的原因没有消除时，这次启动会以同样的原因失败。创建还没建出 Workspace 自己的 Volume 就失败时，`start` 会把它建出来，Volume ID、存储池与容量都不变。
- 创建或启动失败后，实例已经下发过的，ctrl 会先销毁它再释放资源，Workspace 不持有执行，可以直接再 `start`；销毁也失败时 Workspace 仍持有执行，先 `stop --force` 再 `start`。
- Workspace 的 Template revision 不变。每次显式 `start` 时，Platform 换成这个 Workspace 所在 PlatformKey 当前的默认 revision，见 [Template 与 Platform](/templates/overview)。
- 因容量不足启动失败时，稍后重试，或用 `kibo workspace update` 调小资源后再启动。

### 删除 {#delete}

- `delete` 先说明绑定的 Volume 是一起删除还是保留，再请求确认；不在终端里运行时必须加 `--yes`。
- 绑定上标记为随 Workspace 删除的 Volume 一起删除；其他 Volume 只解除绑定，回到 `AVAILABLE`，数据原样保留。
- 已删除的 Workspace 仍可以查询，`kibo workspace list --include-deleted` 列出它们。
- 开始过删除、没有完成的 Workspace，再执行一次 `delete` 完成它。想确认占用的资源是否已全部释放，用[查看释放情况](#cleanup-status)。

## 到期 {#expiration}

Workspace 可以设置一个到期时间，到期后由 ctrl 自动停止或删除它。到期动作由 ctrl 执行，`kibo` 退出不影响它。

### 字段 {#expiration-fields}

`kibo workspace get` 的 `Expires` 一行显示到期时间与动作。JSON 输出的 `expiration` 包含：

| 字段 | 含义 |
|---|---|
| `revision` | 到期设置的版本，只增不减。没有设置到期时间时也有版本号 |
| `expires_at` | 到期时刻 |
| `action` | 到期动作：`WORKSPACE_EXPIRATION_ACTION_STOP` 或 `WORKSPACE_EXPIRATION_ACTION_DELETE` |
| `claimed_command_id` | ctrl 已开始执行到期动作时，对应命令的 ID |

### 创建时设置 {#expiration-on-create}

```bash
kibo workspace create --template "$template_id" --expires-in 8h
kibo workspace create --template "$template_id" --expires-in 30m --expiration-action delete
```

- `--expires-in` 是正的时长，例如 `90s`、`20m`、`8h`、`1h30m`。倒计时从 ctrl 受理命令开始，包含创建耗时。不传则不设置到期时间。
- `--expiration-action` 默认 `stop`：Workspace 停止，Volume 与可写层保留。选 `delete` 时 Workspace 被删除；新建的 Volume 默认随 Workspace 删除，`/data` 里的数据会一起消失。`--expiration-action` 必须与 `--expires-in` 一起使用。
- 访问文件或执行命令不会延长到期时间。`kibo transfer restore` 接受同样的两个参数。

### 单独修改 {#expiration-set}

```bash
kibo workspace expiration set "$workspace_id" --expires-in 20m --expiration-action delete
kibo workspace expiration clear "$workspace_id"
kibo workspace expiration get "$workspace_id"
```

- 只有 `AVAILABLE` 的 Workspace 可以设置到期时间。清除还可以用在 `STOPPED` 的 Workspace，以及不再持有执行、没有开始删除的 `FAILED` Workspace 上，例如启动在调度阶段失败、留下了启动时设置的到期时间。
- `set` 的 `--expires-in` 从这次修改被受理时起算。`expiration get` 显示整个 Workspace，与 `workspace get` 相同。
- ctrl 已经开始执行到期动作后，不能再通过延期取消。
- 不传 `--expected-revision` 时 `kibo` 先读取当前版本再提交。提交时版本已变化则命令失败：重新读取后再决定，不要用旧的意图覆盖新状态。脚本需要重放时把 `--command-id` 与 `--expected-revision` 一起传入：

```bash
revision=$(kibo --json workspace get "$workspace_id" | jq -er '.result.expiration.revision')
kibo workspace expiration set "$workspace_id" --command-id renew-2026-11-06 \
  --expected-revision "$revision" --expires-in 20m
```

### 随启动与停止一起设置 {#expiration-with-lifecycle}

`kibo workspace start` 和 `stop` 也接受 `--expires-in` 与 `--expiration-action`，或者用 `--clear-expiration` 清除到期时间。两组参数互斥。

```bash
# 停止，并让停止后的 Workspace 不带到期时间。
kibo workspace stop "$workspace_id" --clear-expiration
# 启动，并为这次运行设置到期时间。启动耗时计入其中。
kibo workspace start "$workspace_id" --expires-in 30m --expiration-action stop
```

- 到期设置与命令在同一次操作中提交，不存在「已经启动但还没有到期时间」的中间状态，也不需要成功后再执行一次 `expiration set`。
- 不传这些参数时：`stop` 会消费 `stop` 类型的到期设置、保留 `delete` 类型；`start` 不改动到期设置，也不恢复已被消费的设置。
- 命令成功后到期设置的版本加一，结果中带有新的 `expiration.revision` 与 `expires_at`。命令失败不改动到期设置。

到期的完整语义见 [Workspace](/integrate/native-api/workspaces#expiration)。

## 调整资源 {#update}

`kibo workspace update` 修改 Workspace 请求的 CPU、内存与可写层容量，至少给一项。取值写法与 `create` 相同，都是最终值而不是增量。网络策略用 `kibo workspace network` 修改。

```bash
kibo workspace stop "$workspace_id"
kibo workspace update "$workspace_id" --cpu 2 --memory 4G --disk 40G
kibo workspace start "$workspace_id"
```

前提条件：Workspace 不持有执行，即处于 `STOPPED`，或处于 `FAILED`、已经不持有执行、也没有开始过删除。运行中的 Workspace 先 `stop`；失败后仍持有执行的先 `stop --force`；开始过删除的只能再次 `delete`。新值只更新配置，下次启动时生效。

服务端的内存、CPU 与可写层是三条独立的命令，没有一次修改多项的原子操作。`update` 按内存、CPU、可写层的顺序只提交给出的项：

| 情形 | 结果 |
|---|---|
| 全部成功 | 输出最终的 Workspace 与各项结果，退出码 `0` |
| 第一项就失败 | 什么都没改，按失败原因退出，例如运行中返回 `13` |
| 前面的项已生效后某项失败 | 逐项列出 `applied`、`failed`、`not submitted`，不再提交后面的项，退出码 `17` |
| 某项结果未知 | 退出码 `18`，给出该项的命令 ID |

- 命令成功表示新值已保存，不代表下次启动一定能分到足够的 node 容量。因容量不足启动失败后，可以用这条命令把资源调小再试。
- `--disk` 只能增大，已有内容全部保留。等于当前容量时什么都不做；小于当前容量时返回 `invalid_argument`。从未启动过的 Workspace 只记录这个容量，第一次启动时按它创建可写层。
- 内存与 CPU 共用一个资源版本（`--wide` 的 `Revisions` 一节中的 `Resources`）：不传 `--expected-revision` 时 `kibo` 先读取当前版本再提交，提交时版本已变化则返回冲突，不自动重试。`--expected-revision` 只作用于内存与 CPU。
- 脚本需要重放时，把 `--command-id` 与 `--expected-revision` 一起传入；各项的命令 ID 是它加上 `/memory`、`/cpu`、`/disk`。设置为相同的值不会改变版本。
- JSON 输出的 `kind` 为 `WorkspaceUpdate`，`result.changes` 逐项给出 `field`、`value`、`command_id`、`status`（`applied`、`failed`、`unknown`、`not_submitted`）与 `error`。

资源的语义见 [Workspace](/integrate/native-api/workspaces#resources)。

## 绑定、换绑与解绑 Volume {#volume-binding}

```bash
volume_id=$(kibo volume create --capacity 10G -q)
kibo workspace stop "$workspace_id"
kibo workspace volume bind "$workspace_id" --volume "$volume_id" --mount-path /srv/data
kibo workspace start "$workspace_id"
```

`kibo workspace volume bind` 把一个已有的 Volume 绑定到已停止的 Workspace。它写的是完整的绑定：换成另一个 Volume、只改挂载路径、只翻转「随 Workspace 删除」开关，都是再次执行这条命令并写出想要的最终值。`kibo workspace volume unbind` 解除绑定。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--volume` | 必填 | 要绑定的 Volume ID；只改路径或开关时写当前已绑定的那个 |
| `--mount-path` | `/data` | 挂载路径，规则同[创建](#volume-flags) |
| `--delete-with-workspace` | 关闭 | 删除 Workspace 时连同 Volume 一起删除。**不写时新绑定为保留**，即使原来的绑定是随 Workspace 删除 |
| `--expected-revision` | 读取当前值 | 绑定版本，见 `--wide` 的 `Revisions` 一节中的 `Volume binding` |

- 前提条件与[调整资源](#update)相同：Workspace 不持有执行。运行中返回 `failed_precondition`，先 `stop`。
- 被换掉或解绑的 Volume 不会被删除：它回到 `AVAILABLE`，数据原样保留，可以绑到别的 Workspace，或用 `kibo volume delete` 显式删除。这与它原来的开关无关；开关只决定 `kibo workspace delete` 的行为。
- 目标 Volume 必须存在、处于 `AVAILABLE`、没有被其他未删除的 Workspace 绑定，并且这个 Workspace 已经放置的 node 能访问它。不满足时分别返回 `not_found` 与 `failed_precondition`，绑定不变。
- 新绑定在下一次 `start` 时挂载。解绑后的 Workspace 没有承诺持久的路径，不能 `kibo transfer export`。换路径后，旧挂载点留在可写层里，只是一个普通目录。
- 不传 `--expected-revision` 时 `kibo` 先读取当前版本再提交；提交时版本已变化则返回 `aborted`（退出码 `13`），不自动重试。传 `--command-id` 时必须同时传 `--expected-revision`。提交与当前完全相同的绑定不改变版本。这个版本与资源版本各自独立。
- 需要服务端宣告 `workspace.volume_binding.update`。

绑定的语义见 [Workspace](/integrate/native-api/workspaces#volume-binding)。

## 查看释放情况 {#cleanup-status}

```bash
kibo workspace cleanup-status "$workspace_id"
```

查看一个 Workspace 的执行已经释放了哪些部分、还占着哪些部分。停止或删除之后想确认占用是否真的释放时用它。这条命令只读，不触发释放，也不改变状态。

- 总体状态：`COMPLETE`、`PROCESSING`、`NEEDS_ATTENTION` 或 `UNKNOWN`。
- `Components` 一节逐项列出执行的各个部分（`ENTRY`、`SESSIONS`、`RUNTIME`、`VOLUME_BINDING`、`VOLUME_ATTACHMENT`、`RESIDUAL`、`RETAINED_LAYER`、`VOLUME_DELETION`），每项显示状态（`RELEASED`、`PRESENT`、`PENDING`、`ISOLATED`、`UNKNOWN`）、读取来源与观测时间。
- 释放尚未完成时另有 `Release` 一节，写明从什么时候起还欠这次释放，以及最后一次确认执行的时间。这个时间是诊断信息，不是期限：释放仍在重试，`Components` 一节说明还占着哪些部分。
- 观测本身不完整时，结果的 `completeness` 为 `PARTIAL` 或 `UNKNOWN`，退出码相应是 `17` 或 `18`；此时未知的部分不能当作已释放。
- `RETAINED_LAYER` 或 `VOLUME_DELETION` 为 `PENDING`、来源是控制面状态时，Workspace 已删除，文件等存储有可用的 node 时再删除，总体状态在这期间是 `PROCESSING`。

各项的含义见[运行状况观测](/integrate/native-api/observability#cleanup)。

## 幂等键与版本 {#command-ids}

### 幂等键 {#command-id}

`kibo` 发送的每个写操作都带一个幂等键（command ID）。ctrl 把它与输入一起保存：同一个幂等键配同样的输入不会执行两次，重试返回第一次的结果；同一个幂等键配不同的输入以冲突拒绝，退出码 `13`。

- 不传 `--command-id` 时 `kibo` 自动生成一个（形如 `kibo-` 加 32 位十六进制），写命令的输出里带着它（人读输出的 `Command ID:` 一行，JSON 的 `command_id`）。
- 运行可能需要重复的场合（例如脚本可能断线），自己传 `--command-id`：1 到 128 字节，以 ASCII 字母或数字开头，只含字母、数字、`.`、`_`、`/`、`-`。`guest-shutdown/` 与 `host-memory/` 前缀保留给服务端。
- 结果未知时，用同一个幂等键和同样的参数重跑同一条命令，或者用它查询；**查不到命令不代表请求失败，不要因此换一个幂等键重新提交**。
- 对 `start`、`stop`、`delete`：ctrl 已有这个幂等键的命令时，`kibo` 不再提交，直接报告它的结果；仍在处理中时等待它完成，加 `--no-wait` 时返回处理中的记录。这个幂等键属于另一个 Workspace 或另一种命令时报错，换一个。到期参数是命令输入的一部分：同一个幂等键换一个 `--expires-in` 会被判定为冲突，不会静默延期。

规则的完整说明也可以用 `kibo help command-ids` 查看；接口层的约定见[幂等键](/integrate/native-api/conventions#idempotency)。

### 版本校验 {#expected-revision}

一部分修改只在资源仍是调用方看到的那个版本时才生效。不传期望版本时 `kibo` 先读取当前版本再提交；提交时版本已变化，说明别人在这期间改过它，命令以冲突结束（退出码 `13`），不自动重试。脚本要重放这类命令时，必须把 `--command-id` 与第一次读到的期望版本一起传入：重放必须是同一条命令，之后再读到的版本会让它变成另一条。

| 命令 | 期望版本参数 | 版本从哪里读 |
|---|---|---|
| `workspace start`、`stop`、`delete` | `--expected-expiration-revision`（正数，可选） | `.result.expiration.revision` |
| `workspace expiration set`、`clear` | `--expected-revision` | `.result.expiration.revision` |
| `workspace update`（`--cpu`、`--memory`） | `--expected-revision` | `.result.spec.resources_revision` |
| `workspace volume bind`、`unbind` | `--expected-revision` | `.result.spec.binding_revision` |
| `workspace labels`、`annotations` 的 `set`、`clear` | `--expected-revision` | `.result.labels_revision`、`.result.annotations_revision` |
| `workspace network add`、`remove` | `--expected-revision` | `.result.spec.network_policy.revision` |
| `workspace network set` | `--expected-revision`（可选；不传时不检查版本） | 同上 |
| `egress update`、`resolver update` | `--expected-revision` | `kibo --json egress get` 的 `.result.revision` |

表中路径是 `kibo --json workspace get` 的输出；人读输出在 `--wide` 的 `Revisions` 一节。`start`、`stop`、`delete` 是例外：给出 ctrl 已有的幂等键时，它们报告或等待那条命令，不需要期望版本。接口层的约定见[版本校验](/integrate/native-api/conventions#expected-revision)。

### 查询命令结果 {#command-get}

```bash
kibo workspace stop "$workspace_id" --command-id stop-2026-11-06
kibo --json workspace command get "$workspace_id" stop-2026-11-06
```

`kibo workspace command get` 按幂等键查询一条 Workspace 命令：`status` 为处理中或已完成，完成时带 `error` 或对应的结果。`create`、`start`、`stop`、`delete`、到期、网络策略、资源、Volume 绑定与 labels 的命令都可以这样查询；`update` 的各项用加了 `/memory`、`/cpu`、`/disk` 的命令 ID 查询。Volume 的命令用 `kibo volume command get`，见 [Volume 与数据迁移](/integrate/kibo/storage)。

## 下一步 {#next-steps}

- [网络、Egress 与 Resolver](/integrate/kibo/network)
- [Volume 与数据迁移](/integrate/kibo/storage)
- [端口、公开 URL 与桌面](/integrate/kibo/services)
- [Workspace 生命周期](/guide/workspace-lifecycle)
- [kibo 命令参考](/reference/kibo-cli#exit-codes)
