---
title: 集成最佳实践
description: 把 Kibotos 接入生产业务时的建议：数据放置、幂等与重试、版本校验、能力协商、凭证缓存、到期策略、容量错误、网络最小权限与观测。
---

# 集成最佳实践

本页汇总把 Kibotos 接入自己的产品时值得遵守的做法。每一条都对应接口的一个实际行为，链接里有完整的语义。适用于原生 API 与 E2B 兼容 API 的接入方，只适用于其中一种的条目单独标出。

## 数据放置 {#data-placement}

- **需要保留的数据只写进 Volume。** 默认挂在 `/data`。home 目录与根文件系统的其他位置只是尽力保留，`/tmp`、`/run` 每次启动都是空的。
- **在 Volume 里工作。** 执行命令时把工作目录设为 `/data` 下的目录（`kibo` 用 `-w /data`），依赖也装进 Volume，例如 `kibotos-memoh` 把工作区安装的命令放在 `/data/.memoh/deps`。
- **不要依赖内存与进程跨暂停保留。** 停止、E2B 的暂停、宿主内存耗尽后的恢复，都会重新启动 guest。长任务要能从 Volume 里的检查点继续。
- **凭证文件放在不导出的目录。** Volume 根目录下的 `.kibotos/credentials` 与 `.kibotos/browser-state` 不随 Transfer 导出。见[数据持久性与保护](/security/data)。

## 幂等与重试 {#idempotency}

- **每个写请求都带幂等键，并在发出前保存它。** 原生 API 用 `command_id`；E2B 用 `Idempotency-Key` 头。
- **超时或结果未知时，用原来的幂等键重发，不要换新的。** 同一个键加同样的输入只执行一次；换一个键可能创建出第二个 Workspace。
- **查不到命令不代表请求失败。** 先用原来的键重发，或用 `GetWorkspaceCommand`、`GetVolumeCommand` 查询。
- **按命令的返回时机等待。** 创建与启动受理即返回，之后轮询状态或命令结果；停止与删除最多等 1 分钟，返回可重试的 `unavailable` 时命令仍在执行。
- **按 `retryable` 决定是否重试。** 原生 API 的错误详情带 `retryable`；不可重试的错误不要循环重试。

详见[调用约定](/integrate/native-api/conventions#idempotency)。

## 版本校验 {#expected-revision}

- **读改写时带上读到的版本。** 修改网络策略、资源、Volume 绑定、labels 与 annotations、Egress、Resolver 时，先读出当前对象，改好后带上版本号提交。
- **版本冲突后重新读取，再决定下一步。** 返回 `aborted`（到期设置是 `failed_precondition`）说明别人已经改过，不要自动用新版本重放旧意图。
- **一次修改多项时注意它们不是原子的。** CPU、内存与可写层是三条独立的命令；`kibo workspace update` 中途失败时会逐项列出已生效与未提交的部分。

详见[调用约定](/integrate/native-api/conventions#expected-revision)。

## 能力协商 {#capabilities}

- **启动时与升级后读一次 `GetServerInfo`。** 按能力名精确匹配，缺失时只让这一个功能降级或失败。
- **写入新字段前先确认能力名。** 老版本的服务端会静默丢掉不认识的字段，例如网络策略的 `allow`、`deny`、`egresses`、`resolvers`，或 labels。
- **不认识的枚举值按最保守的含义处理。** 例如不认识的 Egress 故障类型按故障处理。

详见[能力名清单](/reference/capabilities)。

## 会话凭证 {#session}

- **复用凭证。** 同一个 Workspace 的多次数据面请求复用一张凭证，不要每个请求都申请。
- **提前续签。** 用掉约 80% 有效期（再减去最多 10% 的随机抖动）后重新申请；不要等到只剩几秒，node 允许的时钟偏差是 30 秒。
- **绑定执行代。** 长期缓存时申请 `lifetime = EXECUTION` 并带上 `expected_generation`，Workspace 重启后这张凭证自然失效。
- **被拒绝就丢弃。** 收到 `SESSION_EXPIRED` 或 `SESSION_REVOKED` 时丢弃缓存的凭证，重新申请；不要用同一张凭证重试。
- **交互式会话在后台换凭证。** 终端类场景里每次按键都是新的请求，要在凭证到期前换上新凭证，不必重开输出流。

详见[数据面：文件与进程](/integrate/native-api/data-plane#session)。

## 到期策略 {#expiration}

- **给每个 Workspace 设置到期时间。** 防止调用方异常退出后 Workspace 一直占用资源。
- **按数据的价值选择到期动作。** 需要保留工作成果时选 `stop`；一次性任务选 `delete`，随 Workspace 新建的 Volume 会一起删除。
- **访问不会续期。** 执行命令、读写文件不延长到期时间，活跃的会话要显式延期。
- **E2B：空闲的 bot 用 `autoPause`。** `lifecycle.onTimeout: 'pause'` 让 sandbox 到期时暂停而不是删除；`connect` 只延长到期时间，不会缩短。

详见 [Workspace 生命周期](/guide/workspace-lifecycle#expiration)与[暂停与恢复](/integrate/e2b/pause-resume)。

## 容量与失败 {#capacity}

- **容量不足是可重试的。** 原生 API 返回 `resource_exhausted`，E2B 返回 503。用带抖动的指数退避重试，或调小资源后重试。
- **E2B：恢复失败不会丢 sandbox。** 因容量不足没能恢复的 sandbox 仍是暂停状态，容量恢复后再 `connect` 即可，见[暂停与恢复](/integrate/e2b/pause-resume#capacity)。
- **按固定顺序恢复 `FAILED`。** 先强制停止，再启动；强制停止返回 `failed_precondition` 时直接启动，见 [Workspace 生命周期](/guide/workspace-lifecycle#failure)。
- **检查停止的 `durability`。** `STOP_DURABILITY_UNCONFIRMED` 表示最后的写入可能没有落盘。

## 网络最小权限 {#network}

- **不需要联网就不开。** 原生 API 默认 `DENY_ALL`；E2B SDK 默认开放公网，不需要时创建参数加 `allowInternetAccess: false`。
- **只开需要的地址。** `PUBLIC_INTERNET` 加 `deny: ["0.0.0.0/0", "::/0"]` 与需要的 `allow` 网段，即「只许这些地址」。两个地址族要分别写。
- **以 `network_policy_status` 判断是否生效。** 修改运行中的 Workspace 时，`applied_revision` 等于新的 `revision` 才表示策略已在 node 上生效。
- **需要审计或访问内网时用 Egress。** 出口失败时连接被重置，不会改为直连。

## 端口与公开访问 {#ports}

- **程序之间用服务连接，人看用本机代理。** 服务连接需要凭证、不对公网开放；`kibo workspace service http` 只在本机可访问。
- **公开 URL 只用于可以公开的内容。** Exposure 地址没有访问控制，有效期最长 24 小时。
- **E2B：需要保护的应用端口设为私有。** 创建时 `network.allowPublicTraffic: false`，访问时带 traffic token。
- **长连接要有心跳。** E2B 应用端口上两个方向 15 分钟没有数据的连接会被断开。

## 资源与 guest 观测 {#observability}

- **定期检查 `guest_observation`。** guest 不再回应或内存饱和不会改变 Workspace 的状态，需要你主动发现。
- **区分 OOM 与内存饱和处置。** 进程以信号 9 退出时，读 `memory_kill_count` 与 `latest_memory_kill` 判断是否是 guest 的内存饱和处置，再决定是否调大内存。
- **用 labels 标记归属。** 例如 bot ID、租户 ID、环境，按 label 筛选与清理；不要在 labels 里放秘密，也不要把它当作访问控制。

详见[运行状况观测](/integrate/native-api/observability)。

## 身份管理 {#identity}

- **一个程序一份 Operator 身份。** 用 `kibo enrollment create --operator` 为每个服务单独签发，泄露时只需撤销那一份。
- **身份目录只给运行程序的账号读写。** 不复制、不提交到版本库、不打进镜像。
- **长期运行的程序处理续期。** 身份有效 30 天，续期后在新连接上发出请求。

详见[身份、凭证与访问控制](/security/credentials)。

## E2B 接入 {#e2b}

- **固定 SDK 版本。** 使用已验收的 `e2b@2.46.1`，升级前在测试环境验证。
- **处理 501。** 网关明确不支持的能力返回 501，SDK 抛出带能力名的 `SandboxError`；不要把它当作临时故障重试。
- **不要在创建时传不支持的选项。** 非空的 `envVars`、`mcp`、`iam`，以及域名形式的 `allowOut`，会让创建失败，而不是被忽略。
- **大的 stdin 分块发送。** 单条请求消息最多 4 MiB。

详见[与 E2B 的差异](/integrate/e2b/differences)。

## 下一步 {#next}

- [常见问题排查](/integrate/troubleshooting)
- [限制与默认值](/reference/limits)
