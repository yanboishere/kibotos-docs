---
title: 常见问题排查
description: 接入 Kibotos 时常见的错误现象、原因与处理：创建与启动、停止与恢复、数据面、网络、E2B 网关、kibo 与身份连接。
---

# 常见问题排查

本页按现象列出接入时最常遇到的问题、原因与处理方法。错误码的完整含义见[错误码](/reference/errors)。需要平台运营方协助时，按[获取支持](/help/support)准备信息。

## 创建与启动 {#create-start}

| 现象 | 原因 | 处理 |
|---|---|---|
| 返回 `resource_exhausted`；E2B 返回 503，消息含 `resource_exhausted` | 没有 node 有足够的 CPU、内存或存储容量 | 稍后重试，或调小资源后重试。E2B 的 sandbox 在恢复失败后仍是暂停状态，容量恢复后再 `connect` |
| 返回 `failed_precondition`，`reason` 为 `CAPABILITY_UNAVAILABLE` | 网络策略用到了目的地规则、Egress 或 Resolver，而没有 node 支持 | 去掉这部分策略，或向平台运营方确认哪些能力可用 |
| 返回 `invalid_argument` | 资源写法不对（内存不是 MiB 的整数倍或小于 128 MiB）、label 不合规则、网络条目写法不规范等 | 按错误消息修正；规则见[限制与默认值](/reference/limits) |
| 同一个幂等键返回 `already_exists` | 用同一个键提交了不同的输入 | 换一个新的幂等键提交新的意图；重放旧请求时输入要完全相同 |
| Workspace 一直停在 `CREATING` 或 `STARTING` | 创建与启动由 ctrl 在后台执行，可能在等待调度或下载 Template | 用 `GetWorkspaceCommand` 或 `kibo workspace command get` 查询命令结果；不要换幂等键重新创建 |
| 启动返回 `failed_precondition`，Workspace 是 `FAILED` | 这个 Workspace 仍持有上一次执行 | 先强制停止，再启动，见 [Workspace 生命周期](/guide/workspace-lifecycle#failure) |
| 启动返回 `failed_precondition`，Volume 是 `LOST` | Volume 所在的存储已被宣告丢失，数据不存在 | 不可重试。换绑新的 Volume，或删除这个 Workspace |
| 启动报 Volume 仍被另一台 node 占用 | 上一次执行还没释放 | 稍后重试；那台 node 释放后即可启动 |

## 停止、删除与恢复 {#stop-delete}

| 现象 | 原因 | 处理 |
|---|---|---|
| 停止或删除返回 `unavailable` | 命令最多等 1 分钟，超时后仍在执行 | 用同一个幂等键重发，或查询命令结果 |
| 正常停止一直完成不了 | guest 无法完成同步 | 强制停止；最后的写入可能丢失 |
| `durability` 为 `STOP_DURABILITY_UNCONFIRMED` | 强制停止，或 KiboVM 没能确认可写盘落盘 | 下次启动时文件系统靠日志恢复；关键数据由应用自己 `fsync` |
| Workspace 变为 `STOPPED`，`last_stop.cause` 为 `STOP_CAUSE_HOST_MEMORY_EXHAUSTED` | 宿主内存耗尽，VM 被内核杀掉，ctrl 自行强制停止 | 直接启动；内存与进程不保留 |
| Workspace 变为 `STOPPED`，`last_stop.cause` 为 `STOP_CAUSE_GUEST_SHUTDOWN` | guest 里的程序关闭了机器（KiboVM 后端） | 直接启动 |
| Workspace 进入 `FAILED`，`failure.message` 写明复位次数 | guest 10 分钟内复位超过 3 次 | 强制停止后启动；检查 guest 里是什么在反复重启 |
| 删除后清理状态一直是 `PROCESSING` | Volume 或可写层所在的存储池暂时没有可用的 node | 文件在存储池恢复可用后删除，无需操作 |

## 数据面 {#data-plane}

| 现象 | 原因 | 处理 |
|---|---|---|
| 返回 `permission_denied`，`reason` 为 `SESSION_EXPIRED` 或 `SESSION_REVOKED` | 凭证过期、被撤销，或 Workspace 已重新启动 | 丢弃缓存的凭证，重新申请 |
| 返回可重试的 `unavailable` | guest 正在自己重启，或 node 正在交接数据面 | 重试 |
| 请求一直超时，Workspace 仍是 `AVAILABLE` | guest 不再回应 | 看 `guest_observation`；一直不恢复时强制停止，再启动 |
| 进程以信号 9 退出 | 内核 OOM，或 guest 的内存饱和处置 | 读 `memory_kill_count` 与 `latest_memory_kill` 区分；调大内存 |
| `Start` 返回 `resource_exhausted` | guest 里的任务数用满 | 结束不需要的进程后重试 |
| 以默认账号执行返回 `failed_precondition`（`CONFLICT`），消息注明账号 | Template 声明的账号在 guest 里被删除或改名 | 以 `root` 恢复账号后重启 Workspace |
| 进程启动报工作目录不存在 | `working_directory` 指向的目录不存在或无权进入 | 先创建目录，或改用存在的目录 |
| 进程流以 `data_loss` 结束，或 `kibo exec` 报告丢失字节 | 断开太久，输出超过保留的 1 MiB | 把大量输出写进文件，再下载文件 |
| 目录监视以 `resource_exhausted` 结束 | 事件来不及送达，例如调用方 5 秒没有读取 | 重新监视，并用 `ListDir` 取全量 |
| `/v1/files` 返回 413 | 文件系统空间或配额用尽 | 清理空间，或扩容可写层、Volume；不可重试 |
| `/v1/files` 返回 403 | 写入的目录只读 | 换一个可写的目录；不可重试 |
| `/v1/files` 返回 408 | 调用方 5 秒没有发送请求体 | 检查上传端是否卡住 |

## 网络 {#network}

| 现象 | 原因 | 处理 |
|---|---|---|
| guest 里所有连接立即失败，DNS 也失败 | 网络策略是 `DENY_ALL` | 改为 `PUBLIC_INTERNET`；只开需要的地址 |
| 访问某个地址立即失败，`allow` 也放不开 | 目的地址是私有或特殊用途地址，任何策略下都拒绝 | 这类地址只能经 Egress 访问，见[隔离与网络安全](/security/isolation#hard-deny) |
| 修改了策略，但连接仍按旧规则 | 策略还没在 node 上生效 | 看 `network_policy_status.applied_revision` 是否等于新的 `revision` |
| 经 Egress 的连接被重置 | 出口连不上、TLS 校验失败或认证失败 | 看 `egress_observations` 的故障类型；出口失败不会改为直连 |
| DNS 返回 `SERVFAIL` | 引用的 Resolver 上游不可用或超时 | 看 `resolver_observations`；不会回退到部署的 DNS |
| 引用 Resolver 返回 `failed_precondition`（`CONFLICT`） | 这个 Workspace 在升级前启动，还在用旧的 DNS 配置 | 停止再启动后即可引用 |

## E2B 网关 {#e2b}

| 现象 | 原因 | 处理 |
|---|---|---|
| 创建返回 501，消息 `unimplemented: ... is not supported by the core gateway` | 请求带了不支持的选项，例如 `envVars`、`mcp`、域名形式的 `allowOut` | 去掉这些选项，见[与 E2B 的差异](/integrate/e2b/differences#unsupported) |
| `connect` 返回 409，消息以 `sandbox failed:` 开头 | sandbox 因不可重试的原因失败，例如 VMM 故障 | 请平台运营方强制停止它，之后 `connect` 即可恢复 |
| 暂停返回 409 | sandbox 已经暂停 | SDK 的 `pause()` 会返回 `false`，无需处理 |
| 应用端口返回 401 | token 已撤销，或 sandbox 已重新启动 | 重新 `connect` 取得 token |
| 应用端口返回 502 | 连不上 guest 里的这个端口（服务还没监听），或 node 拒绝了会话凭证而执行没有变化 | 确认服务监听在 guest 的 IPv4 回环地址（`127.0.0.1` 或 `0.0.0.0`）上，稍后重试 |
| 应用端口返回 503 | sandbox 没有在运行（例如已暂停），或查询 sandbox 状态失败、平台暂时不可用 | 已暂停的先 `connect`；其他情况稍后重试，不需要刷新 token |
| WebSocket 在安静一段时间后断开 | 两个方向 15 分钟没有数据 | 应用自己发心跳 |
| 修改网络返回 500 | 30 秒内没能确认新策略生效，修改可能已被接受 | 用 `getInfo()` 读回当前配置后再决定 |
| 指标接口返回 501 | 部署没有接入实例指标存储 | 向平台运营方确认 |
| `GET /sandboxes/{id}` 返回 500，提到 Volume | sandbox 挂载的 Volume 已删除或不可用 | 这不是 sandbox 不存在；检查 Volume 的状态 |

## kibo {#kibo}

| 退出码 | 含义 | 处理 |
|---|---|---|
| `2` | 参数或配置错误、本地证书校验失败，或未确认的删除 | 按错误信息修正；脚本里删除加 `--yes` |
| `10`、`11` | 未认证、无权限 | 检查 context 与身份是否过期或被撤销 |
| `12` | 对象不存在 | 检查 ID；ID 前缀没有匹配时也是这个退出码 |
| `13` | 状态或版本冲突 | 重新读取当前状态后再决定 |
| `14` | 服务端不支持该操作 | 服务端没有宣告所需的能力名，见[能力名清单](/reference/capabilities) |
| `15` | 服务暂时不可用（只读命令） | 稍后重试 |
| `16` | 等待超时或取消，服务端的操作仍在进行 | 继续等待或查询 |
| `17` | 结果不完整，例如 `workspace update` 只生效了一部分 | 按输出逐项处理 |
| `18` | 结果未知：不能确定服务端是否执行了操作。写命令遇到 `unavailable`（例如 Volume 搬迁期间）、超时或等待中止都属于这一类 | 用同一个 `--command-id` 重跑，或 `kibo workspace command get` 查询 |
| `21` | 完整性校验失败 | 重新传输 |
| `255`（`exec`、`terminal`） | `kibo` 自身失败，例如 30 秒内没能续上连接 | 看错误输出里的类别 |

完整的退出码见 [kibo 命令参考](/reference/kibo-cli#exit-codes)。

## 身份与连接 {#identity}

| 现象 | 原因 | 处理 |
|---|---|---|
| 注册返回 `already_exists` | 这把注册密钥已经换取过身份 | 请签发方重新签发 |
| 注册返回 `failed_precondition`（`enrollment grant is no longer usable`） | 注册密钥已过期（默认 1 小时有效）或被撤销 | 请签发方重新签发 |
| 一段时间后某个程序的请求被拒绝 | 多个程序共用一个身份目录，各自续期后旧证书失效 | 每个程序使用自己的身份 |
| 续期后请求仍被拒绝 | 长期运行的程序还在用续期前建立的连接 | 续期后在新连接上发请求 |
| 连接 ctrl 时证书校验失败 | 连接用的主机名与 ctrl 证书不一致，或信任了错误的 CA | 使用平台运营方给出的 ctrl 地址；控制面只信任 context 里的 `server-ca.pem` |
| 浏览器直连数据面失败 | 数据面证书由内部 CA 签发，浏览器不信任 | 用 `kibo workspace service bridge`、`service http` 或桌面查看页面在本机中转 |

## 下一步 {#next}

- [错误码](/reference/errors)
- [获取支持](/help/support)
