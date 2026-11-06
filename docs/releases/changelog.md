---
title: 变更记录
description: Kibotos 各版本中调用方需要知道的变化：升级须知、新增、变化与修复，覆盖 v0.3.0、v0.2.1、v0.2.0 与 v0.1.0。
---

# 变更记录

本页记录每个版本里调用方需要知道的变化，读者是接入 Kibotos 的开发者与技术负责人。安装、配置、升级步骤、运维命令、指标与看板等平台侧的变化由平台运营方处理，本页只在每个版本开头用一句话带过。

**承诺范围**是外部应用直接调用的接口：`kibotos.ctrl.v1`、`kibotos.operator.v1`、`kibotos.enrollment.v1`，以及 node 数据面的会话凭证用法、文件传输 HTTP 入口、公开 WebSocket 流入口和它们使用的 `kibotos.service.v1` 消息。这些接口仍可能出现不兼容变更，但旧形态在引入新形态的版本里继续工作，最早在下一个 MINOR 版本删除，PATCH 版本不删除任何东西。

E2B 兼容 API 的行为与 `kibo` 的参数、输出不在承诺范围内。它们的不兼容变化同样写进对应版本的「升级须知」，前面标出组件。兼容窗口的完整说明见[兼容策略](/releases/compatibility)。

每个版本先列「升级须知」，即调用方要处理的不兼容改动与弃用，之后是新增、变化与修复。本页从 `v0.1.0` 开始记录，更早的 `v0.0.x` 是预发布版本，没有兼容承诺。

## v0.3.0 {#v0-3-0}

平台侧的变化（数据库迁移、凭证加密密钥的备份、宿主内核与系统账户的要求、DNS 服务器的配置、集群指标与看板等）由平台运营方处理。

### 升级须知 {#v0-3-0-upgrade}

- API：`VolumeState` 新增 `LOST`，`FailureReason` 新增 `VOLUME_LOST`。只有平台运营方宣告存储池丢失才会出现；这之后绑定 `LOST` Volume 的 Workspace 启动返回 `failed_precondition`，不可重试。`GetServerInfo` 宣告 `volume.lost`。
- API：Volume 与 Workspace 在存储池没有可用 node 时也能删除。`DeleteVolume`、`DeleteWorkspace` 此前返回可重试的 `unavailable`，现在立即完成，`GetWorkspaceCleanup` 的 `RETAINED_LAYER`、`VOLUME_DELETION` 报告 `PENDING`，直到文件删除。见[清理结果](/integrate/native-api/observability#cleanup)。
- Operator API：删除 `NodeResources.ephemeral_disk_bytes`（`v0.2.0` 起弃用），改读 `StoragePool` 的 `capacity_bytes` 与 `reserved_bytes`。
- node：升级后启动的 Workspace 的 `/etc/resolv.conf` 只有一个 `nameserver`，即 guest 网关地址（IPv6 为 `fe80::1`），此前列出部署的 DNS 服务器；升级前启动的 Workspace 保持原来的配置直到重启，重启前不能引用 Resolver。见 [DNS](/integrate/native-api/network-policy#dns)。
- 数据面：会话凭证的 JWS 头 `alg` 从非标准的 `Ed25519` 改为 RFC 8037 的 `EdDSA`，标准 JWS 库可以直接校验；node 在 v0.3.x 里两种都接受，`Ed25519` 最早在 v0.4.0 不再接受。按文档把 `credential` 当不透明字符串使用的不受影响；自己解析或校验凭证、按 `alg` 判断的，改为接受 `EdDSA`。升级前申请的会话在升级后用同一 `command_id` 重放，得到的凭证字符串与原来不同，两张都有效。见[申请会话凭证](/integrate/native-api/data-plane#session)。
- e2b：网关写在 Workspace、Volume 与 Egress 上的 key 改用前缀 `e2b.kibotos.app/` 与 `m.e2b.kibotos.app/`；旧前缀 `e2b.kibotos.io/`、`m.e2b.kibotos.io/` 在本版本仍被读取并改写，`v0.4.0` 起不再读取。经原生 API 或 `kibo` 读取、筛选这些 key 的，改用新前缀。
- kibo：JSON 输出的 `api_version` 改为 `kibo.kibotos.app/v0`，此前是 `kibo.kibotos.dev/v0`。
- API：`GuestObservation` 新增 `restart_count` 与 `last_reset_at`，报告这次执行里 guest 自己复位、node 换了 VMM 的次数与最近一次复位的时间；`kibo workspace get` 的 Guest 一行也显示。只新增，调用方不用改。
- API：guest 自己关机的 Workspace 不再进入 `FAILED`，而是进入 `STOPPED`，`StopCause` 新增 `GUEST_SHUTDOWN`，`GetServerInfo` 宣告 `workspace.stop.guest_shutdown`。按 `last_stop.cause` 判断停止原因的，把新值当作一次可以直接 `StartWorkspace` 的停止；命令 ID 前缀 `guest-shutdown/` 保留给服务端。见[停止原因](/integrate/native-api/observability#stop-cause)。
- guest：受管进程持续顶在内存上限时，guest 杀掉其中常驻内存最大的进程，此前它们一直停滞到调用方强制停止。依赖某个进程一直存活的，要处理它以信号 9 退出的情况；读 `GuestObservation.memory_kill_count` 与 `latest_memory_kill` 判断是否发生过。只对用上本版本 Platform 的 Workspace 生效。见[内存饱和](/integrate/native-api/observability#memory-saturation)。

### 新增 {#v0-3-0-added}

- API：调用方自带的 SOCKS5 出口。`EgressService` 管理 Egress（口令只写、`expected_revision`、`drain_seconds`、被引用时不能删除），网络策略的 `egresses` 让指定网段的 TCP 经它离开，`network_policy_status` 按 Egress 报告生效的 revision 与排空中的 revision，`egress_observations` 报告出口故障，`UpdateWorkspaceNetworkPolicy` 新增 `drain_seconds`；能力名 `workspace.network_policy.egress.socks5`，命令行 `kibo egress` 与 `kibo workspace network --egress`、`--egress-destination`、`--drain-seconds`。见 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。
- API：调用方自选的 DNS 上游。`ResolverService` 管理 Resolver（`udp`、`tcp`、`tls`、`https` 四种协议，`expected_revision`、被引用时不能删除），网络策略的 `resolvers` 让 guest 的 DNS 查询直接或经策略里的 Egress 转给它，上游不可用时回 `SERVFAIL`、不回退部署的 DNS 服务器；`network_policy_status.resolvers` 报告生效的 revision，`resolver_observations` 报告上游故障；Egress 新增 `udp_enabled`，让 `udp` Resolver 的查询经 SOCKS5 `UDP ASSOCIATE` 离开，开启 TLS 时这些数据报不受 TLS 保护，出口观测新增 `UDP_ASSOCIATION_FAILED`；能力名 `workspace.network_policy.resolver`。见 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。
- e2b：支持 `egressProxy`，sandbox 的出站 TCP 经调用方的 SOCKS5 代理离开，此前返回 501。见[出站代理](/integrate/e2b/network#egress-proxy)。
- API：`GuestObservation` 新增 `memory_kill_count` 与 `latest_memory_kill`，报告 guest 因内存饱和杀掉的进程与原因；`kibo workspace get` 显示 Guest memory kills。

### 变化 {#v0-3-0-changed}

- node：guest 的 DNS 查询只发往链路 DNS 地址。`DENY_ALL` 的 Workspace 的查询在链路地址上立即被拒绝，没有报文离开 Workspace，用未 connect UDP 查询的解析库（如 musl）按自身超时失败；`PUBLIC_INTERNET` 的 `deny` 不再影响 DNS，覆盖部署 DNS 服务器或整个地址族时经 TCP 的查询也照常成功；guest 直接发往部署 DNS 服务器的 UDP 被拒绝。只对升级后启动的 Workspace 生效。见 [DNS](/integrate/native-api/network-policy#dns)。
- node：`PUBLIC_INTERNET` 的 Workspace 对不以 SYN 开头的新 TCP 流回 RST：Workspace 网络里的连接跟踪条目被删除后（例如排空到期），guest 在原连接上继续发送会被重置，不再被当作新连接放行。
- e2b：进程与文件接口按 E2B 发布的 envd proto 提供，线上格式与 E2B 的 envd 一致：新增 gzip 压缩协商、gRPC 与 gRPC-Web 协议和二进制编码；请求按 protojson 解码，JSON 值之后的多余内容、重复字段、同一 oneof 的多个成员返回 `invalid_argument`，流式请求不是恰好一条消息时返回 `unimplemented`；响应不再输出零值字段；流式接口的错误一律在流的结束消息里返回；一元调用的 HTTP 状态按 Connect 规范对应错误码，`unimplemented` 由 404 改为 501，`failed_precondition` 由 409 改为 400；错误消息不再重复错误码前缀；`/files` 不再处理 `Connect-Timeout-Ms`。见[命令、终端与文件](/integrate/e2b/commands-files)。
- node：node 升级后接管仍在运行的 Workspace 时，按它的网络策略重建防火墙规则，已建立的连接不断开。
- node：guest 自己重启（`reboot -f`、sysrq `b`）时，在同一个 Instance、同一份分配上启动新的 VMM，Workspace 保持 `AVAILABLE`，`generation` 与数据面凭证不变，guest 回来之前数据面新请求返回可重试的 `unavailable`；此前 Workspace 永久落为 `FAILED`。10 分钟内复位超过 3 次时不再重启，Workspace 进入 `FAILED` 并写明次数。目前只对 Firecracker 后端生效，KiboVM 的复位与 VMM 故障退出码相同，仍按故障处理。见 [guest 自己重启或关机](/integrate/native-api/observability#guest-reboot)。
- ctrl：guest 自己关机（KiboVM 后端）时，服务端按强制停止释放这次执行，Workspace 进入 `STOPPED`，Volume 与可写层保留，经 E2B 网关时 sandbox 进入暂停、`connect` 即可恢复。
- 发布物：Platform 归档、Template 与 Launch 清单、prepared input 与构建结果的格式标识改到 `kibotos.app/` 下；`kibotos.io/` 下的旧标识在本版本仍被读取，`v0.4.0` 起不再读取。

### 修复 {#v0-3-0-fixed}

- guest：进程因工作目录不存在、不是目录或运行身份无权进入而启动失败时，错误信息指出工作目录和路径；此前报成 `fork/exec <程序>: no such file or directory`，看起来像程序缺失。路径中间或末尾不是目录时改报 `not_found` 且不可重试，此前是可重试的 `internal`。
- ctrl：用同一命令 ID 重发仍在执行的命令，或强制停止接替正在进行的停止时，命令在前一次尝试结束后立即继续，不再偶尔多等最多几秒才执行或才应答。
- node：交接数据面时，旧数据面进程开始排空后应答的请求一律关闭连接；此前排空刚开始时应答的连接被保留又随即关闭，客户端在它上面发出的下一个请求偶发读到 EOF。
- e2b：因容量不足没能创建的 Volume 不再一直占着名字，容量恢复后同名 `POST /volumes` 返回 201，此前一直返回 409 `volume is not available`；容量仍不足返回 503，扩容或删除失败的 Volume 返回 409 并带失败原因。见 [Volume](/integrate/e2b/volumes)。
- node：Volume 或保留的可写层在存储池之间复制前、保留的可写层启动前核对块文件布局时，superblock 声明的描述符表超过 16 MiB 或超出文件即按不支持的布局拒绝；此前 guest 改写 superblock 可让 node 分配到块文件大小的 1/8，或让 node 进程崩溃。

## v0.2.1 {#v0-2-1}

平台侧的修复（存储池使用权核对时的 NFS 请求量）由平台运营方处理。

### 修复 {#v0-2-1-fixed}

- ctrl：node 停止或正在启动时，继续按它最后上报的数据面证书签发 exec、终端、文件传输与端口转发的新会话；此前 node 停到重新同步完成的整段时间里新建会话以 `unavailable` 失败。
- memoh Template：浏览器 profile 移到工作区 Volume 的 `/data/.memoh/browser`，重启 Workspace 后保留站点的 Cookie 与本地存储；此前 profile 在 `/tmp`，每次重启全部丢失。平台运营方重新发布 memoh Template 后生效。
- ctrl：运行中的 Workspace 因 Instance 意外结束进入 `FAILED` 时不再设置 `failure.stage`，此前报 `STARTING`，看起来像启动失败；`kibo` 对没有阶段的失败不再显示阶段。

## v0.2.0 {#v0-2-0}

平台侧的变化（升级路径与检查、KiboVM runtime、存储池容量的设置方式、数据库与对象存储的配置、日志采集、Prometheus 指标、Trace 与实例指标存储的部署等）由平台运营方处理。

### 升级须知 {#v0-2-0-upgrade}

- Operator API：`NodeResources.ephemeral_disk_bytes` 已弃用，`v0.3.0` 删除；改读 `StoragePool` 的 `capacity_bytes` 与 `reserved_bytes`。
- API：`VolumeSpec.storage_pool` 在 Volume 搬迁后会变，每次从 Volume 读取，不要缓存。
- Template：自建桌面 Template 要按需启动桌面的，放上标记 `/etc/kibotos/desktop-on-demand`，并让在 guest 里以进程方式运行的 X 客户端先向 `/run/kibotos/desktop/request.sock` 发 POST 请求桌面；不放标记的开机启动桌面。见[桌面 Template 规范](/templates/desktop)。
- e2b：`updateNetwork` 不带 `allowInternetAccess` 时打开公网访问；要保持关闭，每次修改都带上它。见[出网策略与出站代理](/integrate/e2b/network)。
- kibo：`kibo workspace update` 不再接受 `--network`，改用 `kibo workspace network`。
- `gen/go/` 下的 Go 生成代码不在承诺范围，见[兼容策略](/releases/compatibility)。

### 新增 {#v0-2-0-added}

- API：`FilesystemService.WatchDir` 监视一层目录；e2b 支持非递归的 `files.watchDir`，命令行 `kibo workspace file watch`。见[目录监视](/integrate/native-api/data-plane#watch-dir)。
- API：进程流断开后可以续传，输出不丢、输入不重复；`kibo workspace exec`、`terminal` 与 e2b 的进程流自动续上。见[进程流续传](/integrate/native-api/data-plane#process-resume)。
- API：网络策略的 `allow` 与 `deny` 按目的地址或 CIDR 收窄公网出站；命令行 `kibo workspace network` 与 `kibo workspace create --allow/--deny`，e2b 的 `allowOut` 与 `denyOut` 支持地址与 CIDR。见[网络策略与 DNS](/integrate/native-api/network-policy#destination-rules)。
- API：`UpdateWorkspaceNetworkPolicyRequest.expected_revision` 让修改在策略被别人改过时返回 `aborted`。见[版本校验](/integrate/native-api/conventions#expected-revision)。
- API：`GuestObservation.memory_condition` 报告 guest 里的进程是否顶在内存上限、持续回收而不 OOM，命令行 `kibo workspace get` 的 Guest memory。见[内存饱和](/integrate/native-api/observability#memory-saturation)。

### 变化 {#v0-2-0-changed}

guest、KiboVM 与 Firecracker 的变化在 Workspace 下次启动、用上本版本的 Platform 后生效。

- guest：带按需启动标记的桌面 Template 在第一次使用桌面时才启动它，没有标记的照旧开机启动。
- guest：一个进程连同后代最多用 guest 任务数上限的 3/4；资源不够启动进程时 `Start` 返回 `resource_exhausted`。见 [guest 内的资源上限](/integrate/native-api/data-plane#guest-limits)。
- guest：释放的内存在十几秒内还给宿主，页缓存除外。
- guest：默认不再看到硬件虚拟化扩展。需要嵌套虚拟化时由部署开启，取决于部署配置，可以向平台运营方确认。
- KiboVM：正常停止确认可写盘写到了存储设备，没确认时 `durability` 为 `STOP_DURABILITY_UNCONFIRMED`。
- KiboVM：不再为每台 VM 启动 `virtiofsd`，每台 VM 多占约 11 MiB guest 内存。
- Firecracker：guest 内核以 `psi=1` 启动，统计内存压力。
- node：停止、重启与同一发布线内的升级不再断开数据面连接。
- ctrl：请求消息超过上限时返回 `resource_exhausted`，`ArtifactPublicationService` 16 MiB，`EnrollmentService` 64 KiB，其他 4 MiB。见[原生 API 概述](/integrate/native-api/overview)。
- ctrl：搬迁中的对象暂不接受其他操作，返回可重试的 `unavailable`。
- ctrl：`GetWorkspaceCleanup` 里运行时几项的 `observed_at` 是 node 观测到清理完成的时刻。
- ctrl：`UpdateWorkspaceExpiration` 可以清除 `STOPPED` 与不再占用执行的 `FAILED` Workspace 的到期时间，此前只接受 `AVAILABLE`。见[版本校验](/integrate/native-api/conventions#expected-revision)。
- e2b：进程与文件接口一元调用的请求体最多 4 MiB，`timeout` 与 `refreshes` 最多 1 MiB。见[命令、终端与文件](/integrate/e2b/commands-files)。
- e2b：ctrl 报告容量不足时返回 503，此前是 502。
- kibo：`kibo transfer export`、`import` 与 `restore` 等到命令完成或到 `--wait-timeout`。

### 修复 {#v0-2-0-fixed}

- 安全：用 Go 1.27.2 构建，修复 HTTP/2 与 `net/http` 的漏洞，例如 GO-2026-6603、GO-2026-6611 与 GO-2026-6617。
- 安全：用 Go 1.27.3 构建，`crypto/x509` 不再信任私钥已泄露的 eMudhra 中间证书（GO-2026-6809）。
- 安全：KiboVM 的 guest 内核升到 7.2.11，修复 IPv4 补齐校验和时可能把 guest 内核内存带进分片的漏洞；Workspace 下次启动后生效。
- node：node 重启时 guest 暂时不回应，Workspace 不再变为 `FAILED`。
- node：node 重启后，大的共享存储池里运行的 Workspace 不再因为接管失败而中断。
- node：node 重启后没能接管的 Workspace，强制停止一次即可成功。
- node：回收已结束 Instance 的记录与过期的 Volume 命令记录，启动与请求不再随记录增多而变慢。
- node：guest 写入慢时，经 `/v1/files` 上传大文件不再以 408 失败。
- node：停止或删除 Workspace 时，先等数据面确认拒绝这次执行的凭证再销毁 VM，两者不再并行。
- guest：`/v1/files` 上传的请求体发完后，不再等整份文件写入存储才响应。
- guest：父进程先退出的进程退出后随即被回收，不再残留为僵尸进程。
- guest：写入只读的目录返回不可重试的 `permission_denied`（`/v1/files` 为 403），空间或配额用尽返回不可重试的 `resource_exhausted`（413），此前都是可重试的 `internal`（500）。
- KiboVM：guest 程序退出时 VM 不再随之关机。
- ctrl：宿主内存紧张的 node 重启后，ctrl 从它重新连上起就不再向它调度，创建不再在约 1 分钟内被它以 `resource_exhausted` 拒绝；node 事件流中断后也随即重读它的内存判断。
- ctrl：服务端存储繁忙时，大量并发的命令不再以 `ctrl state store is unavailable` 失败。
- ctrl：服务端存储短暂停顿时，进行中的 `DeleteWorkspace` 不再失败。
- ctrl：服务端的存储会话被意外替换后，请求最多失败一次，不再持续以 `prepared statement does not exist` 失败。
- ctrl：服务端的存储会话被替换而连接仍然可用时，正在执行的 Workspace 命令在 100 ms 内中止，不再与同一 Workspace 的另一条命令并行执行到结束。
- ctrl：超过约 1 分钟的 Volume 导出与超过约 2 分钟的导入不再失败。
- ctrl：失败或删除的 Transfer 不再留下归档。
- ctrl：最后一次创建或启动失败后删除的 Workspace，清理状态能够变为 `COMPLETE`。
- ctrl：`DeleteVolume` 不再删除刚被 Workspace 绑定的 Volume。
- ctrl：删除 Workspace 不再把扩容失败的 Volume 改回 `AVAILABLE`。
- ctrl：创建的 Instance 在 ctrl 收到回答之前失败时，Workspace 新建的 Volume 不再停在 `CREATING`。
- ctrl：删除 Volume 时，它上面结果未知的命令以 `aborted` 结束。
- ctrl：服务端存储短暂不可用时，创建或启动 Workspace 重试后完成，不再以不可重试的 `FAILED`（`node lifecycle operation failed`）结束。
- ctrl：服务端存储短暂不可用时，删除或扩容 Volume 以可重试的 `UNAVAILABLE` 失败，Volume 保持原状态，不再变为 `FAILED`。
- ctrl：服务端存储短暂不可用时，导出 Workspace 重试后完成，不再以不可重试的 `node Transfer operation failed` 结束；创建 Volume 的失败消息不再带存储的原始错误。
- ctrl：保留的可写层长时间被占用时，删除 Workspace 继续重试，不再变为 `FAILED`。
- ctrl：保留的可写层仍被另一台 node 占用时，启动失败标记为可重试，那台 node 释放后再启动即可；e2b 的 `connect` 随之重新启动 sandbox，不再返回 409。
- ctrl：调度时服务端存储或 Template 目录暂时不可用，创建或启动重试后完成，不再以 `node placement authority is unavailable` 失败；分配冲突、Volume 所在池不可达、Volume 仍被另一台 node 占用与 Template 目录拒绝这个 Launch 各自说明原因。
- ctrl：创建或启动的后续尝试失败时，先销毁前一次尝试已在 node 上创建的 Instance 再释放分配，不再留下 Workspace 显示 `FAILED`、Instance 却一直运行的情况；后续尝试沿用已有的分配，不再重新调度。
- e2b：因容量不足没能启动的 sandbox 按暂停呈现，容量恢复后 `connect` 即可启动它。
- e2b：暂停的 sandbox 在 `connect` 因容量不足没能启动后仍没有到期时间，不再在这次请求的 `timeout` 到期时连同 Volume 被删除。见[容量不足时的恢复](/integrate/e2b/pause-resume#capacity)。
- e2b：sandbox 的根文件系统容量尚未确认时，`GET /sandboxes/{id}` 与 `GET /v2/sandboxes` 不再以 500 失败，这个 sandbox 的 `diskSizeMB` 为 `0`。
- kibo：`kibo workspace terminal` 以远端命令的退出码结束，不再偶发以 `255` 退出。

## v0.1.0 {#v0-1-0}

从这个版本起，承诺范围内的接口承担兼容承诺。平台侧的变化（升级路径、按宿主资源与存储池声明容量、时间同步、数据库连接数、Transfer 归档的存储、E2B 网关的迁移、网关与 node 的配置方式、日志格式等）由平台运营方处理。

### 升级须知 {#v0-1-0-upgrade}

以下改动都相对预发布版本 `v0.0.x`，没有过渡形态，升级后立即生效。

- **`ListVolumes` 默认不再返回已删除的 Volume。**
  - 要做什么：需要 `DELETED` 的 Volume 时，在请求里设置新增的 `include_deleted`。
  - 是否受影响：你的程序是否用 `ListVolumes` 查找、统计或清理已删除的 Volume。
- **Transfer 过期后不能再导入。** 归档默认保留 24 小时，到期未导入的 Transfer 变为 `EXPIRED`，`ImportTransfer` 返回 `failed_precondition`。此前归档一直保留到显式删除。
  - 要做什么：在保留时间内导入；已过期的重新 `ExportWorkspace`。保留时间取决于部署配置，可以向平台运营方确认。
  - 是否受影响：你的程序是否在导出之后隔很久才导入。
- **`/v1/files` 拒绝没有定义的查询参数。** 表外参数、重复参数，以及 `GET` 上的 `mode`、`create_only`，都返回 400（`invalid_argument`）。此前这些参数被忽略。
  - 要做什么：`GET` 只带 `path`、`user`；`PUT` 只带 `path`、`user`、`mode`、`create_only`；每个参数只带一次。
  - 是否受影响：你的程序是否在地址上附加其他参数（例如防缓存的随机参数），或在 `GET` 上带了 `mode`、`create_only`。
- **能力名按统一规则改名，`server.info` 删除。**
  - 要做什么：按下表改用新名字，其余名字不变。命名规则与完整清单见[能力名清单](/reference/capabilities)。
  - 是否受影响：你的程序是否在 `GetServerInfo` 返回的能力列表里查找下表左列的名字。

  | 旧名字 | 新名字 |
  |---|---|
  | `workspace.cpu.set` | `workspace.cpu.update` |
  | `workspace.memory.set` | `workspace.memory.update` |
  | `workspace.network.set` | `workspace.network_policy.update` |
  | `workspace.volume.set` | `workspace.volume_binding.update` |
  | `workspace.disk.resize` | `workspace.writable_layer.resize` |
  | `workspace.exec`、`workspace.terminal` | `workspace.process` |
  | `file.get`、`file.put`、`file.delete` | `workspace.filesystem` |
  | `workspace.service.connect` | `workspace.service_connection` |
  | `server.info` | 删除 |

- **`ExposureOriginService` 移出承诺范围。** 它从 `kibotos.ctrl.v1` 移到 `kibotos.gateway.v1`，RPC 路径变为 `/kibotos.gateway.v1.ExposureOriginService/OpenExposureOrigin`。
  - 要做什么：`kibotos-gw` 与 ctrl 升级到同一版本。
  - 是否受影响：只有自己实现 Exposure 网关、直接调用 `OpenExposureOrigin` 的程序。
- **E2B 调用方要重新 `connect`。** 网关迁移后每个 sandbox 的 envd token 与 traffic token 都会换新，旧 token 失效。
- **调用 `kibo` 的脚本要改写。** 参数与退出码有改动，见下方[`kibo` 命令行](#v0-1-0-kibo)。

### 新增 {#v0-1-0-added}

- **labels 与 annotations。** Workspace 与 Volume 可以带调用方自己的 `labels`（列表可用 `label_selector` 筛选）与 `annotations`（原样保存），规则与 Kubernetes 相同。用 `UpdateWorkspaceLabels`、`UpdateWorkspaceAnnotations`、`UpdateVolumeLabels`、`UpdateVolumeAnnotations` 整体替换。能力名 `workspace.labels`、`workspace.annotations`、`volume.labels`、`volume.annotations`。见 [labels 与 annotations](/integrate/native-api/workspaces#labels-annotations)。
- **强制停止。** `StopWorkspaceRequest.mode` 设为 `STOP_MODE_FORCE` 时，不等 guest 停止写入，只让它短暂同步一次就停止执行，保留 Volume 与可写层。用法见[强制停止](/integrate/native-api/workspaces#force-stop)。
  - 用于正常停止卡住，或失败后仍占用 node 资源的 Workspace。VMM 意外退出（包括 guest 内核崩溃或 guest 内重启）后，Workspace 停在 `FAILED`，要先强制停止才能 `StartWorkspace`。宿主内存耗尽除外，见下方「宿主内存耗尽时的保护」。
  - 未同步的写入可能丢失，响应的 `durability` 为 `STOP_DURABILITY_UNCONFIRMED`。
  - 正常停止与到期停止失败时，不会自动改为强制停止。
  - `v0.0.3-beta.9` 已经声明这个能力，但只接受停止失败的 Workspace。按下方「`FAILED` 的 Workspace 不必删除重建」的顺序处理的调用方，不需要区分服务端版本。
  - 能力名 `workspace.stop.force`，命令行 `kibo workspace stop --force`。
- **guest 无响应观测。** `Workspace.guest_observation` 报告 guest 是否还在回应：连续几次不回应时为 `GUEST_CONDITION_UNRESPONSIVE`，一般 2 分钟内可见；回应一次即恢复。见 [guest 观测](/integrate/native-api/observability#guest-observation)。
  - `ListWorkspacesRequest.guest_condition` 可按它筛选。
  - 它只是观测，不改变 Workspace 的状态。一直不恢复的 guest 用强制停止收回。
  - 能力名 `workspace.guest_observation`，命令行 `kibo workspace list --guest-unresponsive`。
- **绑定当前执行的会话凭证。** `CreateDataPlaneSession` 设置 `lifetime = EXECUTION` 与 `expected_generation` 时，凭证只在 Workspace 当前这一轮执行内有效，最长 1 小时。能力名 `workspace.session.execution`。见[申请会话凭证](/integrate/native-api/data-plane#session)。
- **Volume 可以指定存储池。** `VolumeSpec.storage_pool` 指定 Volume 放在部署声明的哪个存储池，留空用默认池，返回时总是给出实际的池名。能力名 `volume.storage_pool`。
  - 多台 node 接入同一个池（共享池）时，绑定这个 Volume 的 Workspace 可以在其中任意一台启动。
- **Transfer 可以导入到任意 node。** 归档不再保存在导出它的 node 上，导入可以在接入目标池的任意一台 node 上执行，`DeleteTransfer` 也不再需要 node 在线。`ImportTransferRequest.storage_pool` 指定导入的 Volume 放在哪个池，留空为原 Volume 所在的池。能力名 `transfer.import.storage_pool`，命令行 `kibo transfer import --storage-pool`。见 [Volume 与 Transfer](/integrate/native-api/volumes-transfers)。
- **宿主内存耗尽时的保护。**
  - 被宿主 OOM 杀掉的 VM，它的 Workspace 由 ctrl 自行强制停止，进入 `STOPPED`，直接 `StartWorkspace` 即可。停止命令的 ID 以 `host-memory/` 开头，这个前缀保留给服务端。见[停止原因](/integrate/native-api/observability#stop-cause)。
  - `Workspace.last_stop` 说明 Workspace 为什么停止（调用方、到期、宿主内存耗尽）、由哪条命令停止、是否确认写入已到达存储。
  - 宿主可用内存低于总内存的 10% 时，node 不再接收新的 Workspace，ctrl 立即改调度到别处，都放不下时返回 `resource_exhausted`；回到 15% 以上后恢复。
  - E2B 调用方看到这样的 sandbox 进入暂停，`connect` 即可恢复。

### 变化 {#v0-1-0-changed}

- **VMM 启动失败时，Workspace 的失败信息不再附带 VMM 日志的末尾。**
- **耗时的命令可能返回可重试的 `UNAVAILABLE`。** `StopWorkspace`、`DeleteWorkspace`、`RevokeWorkspaceDataPlane`、`ExportWorkspace`、`ImportTransfer`、`RestoreWorkspace` 被接受后由 ctrl 持续执行，调用方断开或 node 暂时不可达都不会中断它。调用仍然等待结果，最长 1 分钟；超时返回可重试的 `UNAVAILABLE`，命令继续执行。此前 node 一次失败就立即返回失败。
  - 要做什么：收到这种 `UNAVAILABLE` 时，用同一个命令 ID 重试，取得最终结果。不要换命令 ID。
  - ctrl 重试 15 分钟仍不能完成时：停止、删除与数据面撤销让 Workspace 进入 `UNKNOWN`，可以强制停止或删除；导出让 Transfer 进入 `FAILED`，换一个命令 ID 重新导出；导入让 Transfer 进入 `FAILED`，要重新导出后再导入。
- **恢复与导入进行中也能查到。** 恢复中的 Workspace 与导入中的 Volume 出现在 `GetWorkspace`、`ListWorkspaces`、`GetVolume`、`ListVolumes` 里，状态为 `CREATING`。此前命令完成前查不到。
- **导出期间锁定源 Workspace。** 导出期间 `DeleteWorkspace` 返回可重试的 `UNAVAILABLE`，`StartWorkspace` 等导出结束后执行。源 Workspace 已经重新启动过或换了 Volume 时，导出以 `failed_precondition` 失败，重新停止后可以换一个命令 ID 再次导出。
- **`FAILED` 的 Workspace 不必删除重建。** 创建或启动失败后，ctrl 销毁没有就绪的实例并释放 node 资源，之后可以直接 `StartWorkspace`。此前多数失败之后只能删除。
  - 已释放资源的：接受 `StartWorkspace`、修改 CPU、内存、Volume 绑定与可写层大小，以及删除。
  - 仍占用资源的（例如 VMM 意外退出、销毁失败）：接受强制停止与删除。
  - 提交过删除的：只接受再次删除。
  - 要做什么：处理 `FAILED` 的 Workspace 时，先强制停止，返回 `failed_precondition` 再 `StartWorkspace`，不必删除重建。
- **存储容量从创建起占用。** Volume 与 Workspace 的可写层从创建起占用存储池容量，停止不释放，直到删除。停止的 Workspace 重新启动时，不会因为存储被其他对象占去而失败。
  - 池容量不足时，创建 Workspace、创建 Volume、`ResizeVolume` 与 `ResizeWorkspaceWritableLayer` 返回可重试的 `RESOURCE_EXHAUSTED`。
  - 创建 Volume 不指定容量时，`spec.capacity_bytes` 返回实际分配的容量。
- **释放的 guest 地址不再马上分给下一个 Workspace。** node 从地址池的随机位置开始找空闲地址，此前总是取最小的一个，刚停止的 Workspace 的 IPv6 地址会直接落到下一个启动的 Workspace 上。IPv6 源地址对外可见，但它标识不了某个 Workspace。
- **被拒绝的修改不再记录命令。** `UpdateWorkspaceMemory`、`UpdateWorkspaceCpu` 与 `UpdateWorkspaceVolumeBinding` 被拒绝时，`GetWorkspaceCommand` 对这个命令 ID 返回 `not_found`，用同一个命令 ID 重发会重新判断。此前少数拒绝会被记成失败的命令，重发只会重放那次失败。
- **导入找不到 node 时 Transfer 仍可导入。** `ImportTransfer` 因为没有可用的 node 或池容量不足而失败时，返回可重试的 `UNAVAILABLE` 或 `RESOURCE_EXHAUSTED`，Transfer 回到 `COMPLETE`，可以换一个命令 ID 再次导入。此前 Transfer 进入 `FAILED`，只能重新导出。
  - 导入在 node 上失败、Transfer 进入 `FAILED` 时，错误不再标为可重试：这个 Transfer 不能再导入，要重新导出。
  - 是否受影响：你的程序是否在导入失败后按 `retryable` 决定重试，或在导入失败后总是重新导出。
- **启动时 Volume 不存在返回 `not_found`。** `StartWorkspace` 绑定的 Volume 已经不存在时，返回 `not_found`。此前返回 `unavailable`。
- **Template 声明的账号在 guest 中不可用时，Workspace 照常启动，只有以该账号执行的请求失败。** 账号不存在、uid 或 gid 为 0 或缺少 home 目录时，`CreateWorkspace` 与 `StartWorkspace` 照常完成。不指定 `user` 或指定该账号的 `ProcessService/Start`、`FilesystemService` 请求与 `/v1/files` 返回 `failed_precondition`，`ErrorDetail.reason` 为 `CONFLICT`，不可重试，`message` 注明账号与原因；`root` 照常可用，桌面不可用。此前启动以可重试的 `internal` 失败，同一 Workspace 每次启动都失败。见[数据面：文件与进程](/integrate/native-api/data-plane)。
  - 要做什么：账号通常是在 guest 中被删除或改名的。以 `root` 恢复账号后重启 Workspace 即恢复。
  - Workspace 用上这个版本的 Platform 后生效。
  - 是否受影响：你的程序是否以默认账号执行，并需要识别这种失败。
- **不指定工作目录的进程在执行账号的 home 目录启动。** `ProcessService/Start` 的 `working_directory` 留空时，进程在执行账号的 home 启动，例如 `/home/user` 或 `/root`；home 不存在时返回 `not_found`。此前在 `/` 启动。Workspace 用上这个版本的 Platform 后生效。
  - 要做什么：需要在 `/` 或 Volume 里执行的，显式传 `working_directory`。
  - 是否受影响：你的程序是否不传 `working_directory`，又依赖相对路径指向 `/`。
- **服务连接超速时放慢，停止读取时保持。** 同一 Workspace 的全部服务连接共用每个方向的速率上限，超过时等待；一端停止读取时，另一端的写入等它恢复。此前单条连接超过 8 MiB/s（突发 256 KiB）就以 `resource_exhausted` 结束，对端 5 秒不读也结束，所以经服务连接转发的大文件会被截断，暂停读取的连接会被断开。Exposure、E2B 应用端口与 `kibo workspace service http` 都走这条连接。
  - 新行为在 node 与 guest 都升级后生效：guest 随 Platform 交付，平台运营方重新发布本版本的 Platform 之前，旧 guest 仍会结束超速或停住的连接。
  - E2B 应用端口的连接在两个方向都没有字节达到 15 分钟时结束，与 Exposure 相同。上游对升级后的连接不设这个期限，见[应用端口与桌面](/integrate/e2b/ports)。
  - 要做什么：依靠这两种 `resource_exhausted` 结束连接的调用方，改为自己设期限。

### 修复 {#v0-1-0-fixed}

- Volume 扩容期间启动它绑定的 Workspace，启动落在执行扩容的 node 上时，刚启动的实例不再在一分钟内被销毁。此前扩容结束后，挂着这个 Volume 的实例会被销毁，Workspace 随之失败。
- 可写层写满后，Workspace 仍能启动。此前上一次运行中删过 Template 自带的文件、之后又写满可写层时，下一次启动根文件系统以只读挂载，同一 Workspace 每次启动都失败。node 现在在可写层里留出 1 MiB，写满时在启动前释放，guest 里看到的可用空间因此少 1 MiB。
- 删除一个创建失败的 Workspace 时，不再解除绑定或删除已被其他 Workspace 使用的 Volume。
- 创建失败、Workspace 自己的 Volume 还没有建出来时，`StartWorkspace` 会重新创建它，不再以 `volume not found` 失败。
- Workspace 在停止状态下绑定、换绑或解绑 Volume 之后再删除，`GetWorkspaceCleanup` 能报告完整的清理结果。此前各项一直是 `UNKNOWN`，整体一直是 `UNKNOWN` / `PARTIAL`。
- 强制停止可以释放创建或启动失败后仍占用的资源，Workspace 不再停在 `STOPPING`。
- 创建与启动超时、node 上确认没有实例时，Workspace 进入 `FAILED` 并释放资源，可以直接重新启动，不再一直停在 `UNKNOWN`。
- 在 guest 中给 `/etc/resolv.conf`、`/etc/hosts` 或 `/etc/hostname` 加上 immutable 或 append-only 属性后，Workspace 照常启动，这几个文件照常按部署重写。可写层写满时，启动也不再因为改写这几个文件失败。此前这两种情况下同一 Workspace 每次启动都失败。Workspace 用上这个版本的 Platform 后生效。
- 停止失败后 node 上已经没有实例时（例如 node 重启），ctrl 自动释放资源，可以直接 `StartWorkspace`，不必先强制停止。
- `ResizeWorkspaceWritableLayer` 中断后，用同一个命令 ID 重发可以完成。
- Volume 与可写层从任何初始容量都能扩到容量上限。此前在默认使用 4 KiB 块的宿主上（例如 Ubuntu 24.04），按 64 MiB 建的对象最多只能扩到 64 GiB，更大的目标扩容失败，重试也不会成功。已经这样失败过的对象，升级后再次扩容可以完成，但根目录下原有的文件会移到 `lost+found`。
- 恢复失败后 Transfer 不再停在 `RESTORING`：Workspace 释放资源或被删除后，Transfer 回到 `IMPORTED`，可以换一个命令 ID 再次恢复。
- `CreateWorkspace` 与 `UpdateWorkspaceNetworkPolicy` 的重放只有 `network_policy.revision` 不同时，不再返回 `already_exists`。
- ctrl 与 node 时钟有偏差时，创建不再停在 `UNKNOWN`，刚签发的会话凭证也不再被判为尚未生效。
- Workspace 里的进程用尽任务数时，Workspace 不再随之退出：新的进程创建失败，文件操作、进程管理与停止照常可用。此前 guest 程序无法再创建线程而退出，Workspace 变为 `FAILED`。见 [guest 内的资源上限](/integrate/native-api/data-plane#guest-limits)。
- Workspace 里的进程用尽内存时，Workspace 不再失去响应：内核结束其中占用内存最多的进程，guest 程序照常可用。此前 guest 反复回收文件页而不结束任何进程，node 报告它无响应。
- 接入 Volume 所在存储池的 node 都不可用时，`DeleteVolume` 返回可重试的 `UNAVAILABLE`，之后可以再次删除。
- 不再占用资源的 `FAILED` 或 `UNKNOWN` Workspace 到达停止期限时，保留原有状态与失败原因。此前状态变为 `FAILED`，失败原因被替换为 `Workspace has no Instance to confirm durable stop`，启动失败的原因只能通过 `GetWorkspaceCommand` 查询。
- Workspace 里已退出进程的隔离清理持续失败时，guest 的内存占用不再随运行时间增长。这类进程在清理完成前仍占用托管进程名额，名额用尽时 `Start` 的错误信息注明其中由它们占用的个数。此前 `Start` 只返回 `guest managed process limit reached`。Workspace 用上这个版本的 Platform 后生效。
- Workspace 里以 root 运行的进程创建过子 cgroup（例如使用 cgroupfs 驱动的容器运行时）时，进程退出后返回正常的退出结果并释放托管进程名额，子 cgroup 里被终止的进程也不再残留为僵尸进程。此前该进程的结果是隔离清理失败，名额一直不释放，`TerminateAll` 每次都失败。Workspace 用上这个版本的 Platform 后生效。
- 服务连接的 WebSocket 入口因消息超出上限、帧不合法或凭证撤销而结束时，即使服务仍在向调用方发送数据，调用方也会收到写明原因的关闭帧。此前这时连接偶尔不带关闭帧就断开，调用方只能看到连接意外结束。

### E2B 兼容网关 {#v0-1-0-e2b}

- **sandbox 指标。** 新增 `GET /sandboxes/{id}/metrics` 与 `GET /sandboxes/metrics`，SDK 的 `getMetrics()` 可以直接使用。部署需要接入实例指标存储，取决于部署配置；没有接入时两个接口返回 501。见 [sandbox 指标](/integrate/e2b/metrics)。
  - 指标可能丢失，不能用于计量或计费。早于这个版本的 Platform 不产生指标，查询返回空数组。
  - 团队指标 `GET /teams/{teamID}/metrics` 与 `GET /teams/{teamID}/metrics/max` 返回 501。
- **默认磁盘 5 GiB。** 新建 sandbox 默认有 5 GiB 根文件系统可写空间，此前为 64 MiB。它从创建起占用存储池容量；默认值取决于部署配置。已有 sandbox 不变。
- **`connect` 不再更换 token。** `connect` 与冷恢复保留原来的 envd token 与 traffic token，与 E2B 一致。
- **metadata 有大小上限。** metadata 超过上限时创建返回 400：原值与其他 annotations 合计不超过 262144 字节，作为 label 的部分与其他 labels 合计不超过 65536 字节。
- **不合法的 sandbox ID 返回 404。**
- **`connect` 对失败的 sandbox 返回 409。** 意外结束而失败的 sandbox 不会自行恢复，重试不会成功，需要平台运营方强制停止后才能再次 `connect`。此前返回 502，调用方会当作可重试的服务端错误反复重试。见[暂停与恢复](/integrate/e2b/pause-resume)。
- **不带 `cwd` 的进程在执行账号的 home 目录启动。** 与 E2B 一致，此前在 `/` 启动。
- **Template 声明的账号在 guest 中不可用时，sandbox 照常恢复。** 不指定账号或指定该账号的命令与文件操作失败：Connect 接口返回 `failed_precondition`，文件上传下载返回 409，响应注明账号与原因，重试不会成功；`root` 照常可用。此前恢复返回 502。

### `kibo` 命令行 {#v0-1-0-kibo}

`kibo` 的参数、输出与交互按一套约定改写。完整写法见 [kibo 命令参考](/reference/kibo-cli)。

| 删除的写法 | 改用 |
|---|---|
| `--cpu-millis`、`--memory-bytes`、`--ephemeral-disk-bytes` | `--cpu`（`2`、`0.5` 或 `1500m`）、`--memory`、`--disk` |
| `--template-id`，restore 的 `--volume-id` | `--template`、`--volume` |
| `set-cpu`、`set-memory`、`resize-disk`、`network set` | `kibo workspace update` |
| 把 `--command-id`、`--yes` 写在子命令之前 | 写在子命令之后 |
| `kibo workspace cleanup` | `kibo workspace cleanup-status` |

- `workspace exec` 与 `workspace terminal` 以远端进程的退出码退出，`kibo` 自身失败时为 `255`，不再使用 `20`。
- `stop` 与 `delete` 默认等待完成。
- `--expires-in` 不带 `--expiration-action` 时，到期动作改为 `stop`，此前为 `delete`。
- 容量写成 `KB`、`MB`、`GB` 时在发请求前拒绝，改写成 `G` 或 `GiB`。
- `exec` 默认不限时，新增 `-i` 转发标准输入、`-e` 设置环境变量。
- `exec` 与 `terminal` 不带 `-w` 时在执行账号的 home 目录启动，此前是 `/data`。要在 Volume 里执行时传 `-w /data`。
- 人读输出重新排版，不是稳定接口。脚本请用 `--json`，或用 `-q` 只输出资源 ID；`--wide` 显示 revision 等更多字段。
- `workspace list` 与 `volume list` 默认不显示 labels，`--wide` 才显示；`-L <key>` 把一个 label 显示成单独的一列。按 label 筛选写 `-l`、`--label key=value`。
- 列表默认只取一页；`--all` 读完全部页。`-q` 只输出了一页时在 stderr 提示，脚本要拿全部 ID 用 `-q --all`。
- 新增 `workspace service http`：把 Workspace 里一个 HTTP 端口代理到本机 `127.0.0.1` 的同号端口，浏览器直接打开。见[端口、公开 URL 与桌面](/integrate/kibo/services)。
- 新增 `workspace service forward`：把 Workspace 里一个 TCP 端口或受管 Unix socket 转发到本机 `127.0.0.1` 的端口，数据库、SSH、VNC 等服务可以用本机客户端直接连。见[端口、公开 URL 与桌面](/integrate/kibo/services)。
- `workspace service bridge` 开着超过会话凭证的有效期（默认 5 分钟）后仍能建立新连接：凭证在到期前自动换新，Workspace 重新启动后也不必重开。此前超过有效期后新连接一律失败。
- **`kibo workspace file get` 与 `file put` 不再受 `--timeout` 限制。** 此前整个传输都算在 `--timeout`（默认 30 秒）里，超过 30 秒的传输必然以 `context deadline exceeded` 失败。现在 `--timeout` 只限制传输前发往 ctrl 的请求；传输连续一分钟没有收发数据时以失败退出。见[管理 Workspace](/integrate/kibo/workspaces)。

## 相关文档 {#related}

- [兼容策略](/releases/compatibility)
- [版本状态与支持范围](/guide/maturity)
- [与 E2B 的差异](/integrate/e2b/differences)
