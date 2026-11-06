---
title: 数据持久性与保护
description: Workspace 中各类数据保存在哪里、保留多久、停止时怎样落盘，Transfer 导出包含什么，以及删除与清理的语义。
---

# 数据持久性与保护

本页说明 Workspace 里的数据存在哪里、在停止与删除时会怎样、Transfer 导出包含什么，帮助你决定敏感数据与需要长期保留的数据该放在哪里。

## 存储层次 {#tiers}

| 数据 | 位置 | 停止后 | 删除 Workspace 后 |
|---|---|---|---|
| Volume 挂载目录（默认 `/data`） | node 存储池中的块文件 | 保留 | 按绑定的「随 Workspace 删除」开关删除或保留 |
| 根文件系统的其他位置（例如 home 目录、`/usr/local`） | 属于这个 Workspace 的可写层 | 尽力保留，可能因缺失或 Template 变化而重建 | 删除 |
| `/tmp`、`/run`、`/dev/shm` | MicroVM 内存中的 tmpfs | 丢失 | — |
| 内存、运行中的进程、网络连接 | MicroVM | 丢失 | — |
| Transfer 归档 | 平台的对象存储 | 不受影响 | 不受影响；按保留期删除 |
| labels、annotations、E2B metadata | ctrl | 保留 | 随删除后的记录保留，可以查询 |

::: tip 需要保留的数据只写进 Volume
只有 Volume 挂载目录承诺在停止与启动之间保留数据。可写层的保留是尽力而为，不能当作快照；E2B 的暂停与恢复也一样，见[暂停与恢复](/integrate/e2b/pause-resume)。
:::

## 停止时的落盘 {#durability}

| 停止方式 | 落盘 | `durability` |
|---|---|---|
| 正常停止 | guest 停止写入并同步文件系统后才停止 Instance；KiboVM 还确认每块可写盘写到了存储设备 | `STOP_DURABILITY_CONFIRMED`；KiboVM 有一块没确认时为 `STOP_DURABILITY_UNCONFIRMED` |
| 强制停止 | 只请 guest 做一次短时间同步，最后的写入可能丢失，效果等同断电 | `STOP_DURABILITY_UNCONFIRMED` |
| 宿主内存耗尽、guest 关机，ctrl 自行强制停止 | 同强制停止 | `STOP_DURABILITY_UNCONFIRMED` |
| guest 自己重启 | 没有落盘的写入可能丢失 | — |

- 已经交给内核的写入会在正常停止时同步；还在应用自己缓冲区里的数据，需要应用自己 flush。
- 下次启动时，文件系统靠日志恢复一致。
- 需要可靠落盘的应用（数据库、索引）在关键写入后自己调用 `fsync`。

## Volume 的生命周期 {#volume-lifecycle}

- **随 Workspace 删除是绑定的属性。** 创建 Workspace 时新建的 Volume 默认随它删除；绑定已有的 Volume 时默认只解除绑定。E2B sandbox 不带 `volumeMounts` 时，网关新建的 `/data` Volume 随 sandbox 一起删除；按名称挂载的 Volume 在删除 sandbox 后保留，需要显式删除。
- **换绑与解绑不删除数据。** 被换下或解绑的 Volume 回到 `AVAILABLE`，数据原样保留。
- **删除是物理删除。** Volume 删除后数据不可恢复。删除时没有可用的 node 访问它所在的存储池，删除立即完成，文件在池恢复可用后删除；`GetWorkspaceCleanup` 的 `VOLUME_DELETION` 在这期间报告 `PENDING`。
- **存储丢失。** 平台运营方宣告某个存储池丢失后，其中的 Volume 进入 `LOST`：数据已经不存在，也不会被换成空的 Volume。绑定 `LOST` Volume 的 Workspace 启动返回 `failed_precondition`，不可重试。

## Transfer 导出 {#transfer}

Transfer 把已停止 Workspace 的 Volume 内容导出成归档，再导入成新的 Volume：

- **导出的内容**：Volume 里的全部文件，保留数值形式的属主。
- **不导出的目录**：Volume 根目录下的 `.kibotos/credentials` 与 `.kibotos/browser-state`（Volume 挂在 `/data` 时即 `/data/.kibotos/credentials` 与 `/data/.kibotos/browser-state`）。
- **存放位置**：平台的对象存储。归档是用户数据；存储的静态加密由平台运营方配置，可以向平台运营方确认。
- **保留期**：默认导出完成 24 小时后删除归档，过期未导入的 Transfer 变为 `EXPIRED`；单个归档默认不超过 1 GiB。两个值取决于部署配置。
- **立即删除**：`DeleteTransfer`（`kibo transfer delete`）立即删除归档，不需要任何 node 在线。

::: warning 浏览器 profile 会被导出
`kibotos-memoh` 的浏览器 profile 在 `/data/.memoh/browser`，不在排除的目录里，会随 Volume 一起导出。profile 里的 Cookie 用 Chromium basic 存储的固定密钥加密，取得归档的一方就能取得其中的登录状态。
:::

建议把 Agent 在 Workspace 里用到的凭证文件放在 Volume 根目录的 `.kibotos/credentials` 下，把浏览器状态放在 `.kibotos/browser-state` 下，它们会留在原 Volume 里，不进入导出的归档。

## 删除与清理 {#deletion}

- 删除 Workspace 后，执行占用的 Instance、网络、可写层与（按设置）Volume 依次释放。用 `GetWorkspaceCleanup` 或 `kibo workspace cleanup-status` 查看哪些部分已经释放、哪些还在处理。
- 观测不完整时结果标为 `PARTIAL` 或 `UNKNOWN`，未知的部分不能当作已释放。
- 已删除的 Workspace 与 Volume 的记录仍可查询，包括它们的 labels 与 annotations。

## 指标与观测数据 {#metrics}

- 部署开启 sandbox 指标时，node 每 5 秒记录一次每个运行中 Workspace 的 CPU、内存与根文件系统用量。样本只按 Instance ID 与 node ID 标识，不包含文件、进程或网络内容。
- 这些指标只用于观察，不是用量或计费数据。存储不可达、guest 没有按时应答或 node 重启时，对应时段的样本会缺失。
- Workspace 的 labels 只有平台运营方列出的少数几个会随指标写入存储；E2B 部署只列出部署命名空间，sandbox 的 metadata 不写入。

## 建议 {#recommendations}

| 数据 | 建议 |
|---|---|
| 代码、依赖、Agent 的工作成果 | 写在 Volume 挂载目录下 |
| 凭证文件 | 放在 Volume 根目录的 `.kibotos/credentials` 下，不随 Transfer 导出；不需要跨停止保留的，放在 `/tmp` |
| 浏览器登录状态 | 视为敏感数据；需要保留时放在 Volume 上，并控制 Transfer 导出的范围 |
| labels、annotations、metadata | 只放标识与非敏感的描述信息 |
| 需要可靠落盘的写入 | 应用自己 `fsync`；停止时用正常停止并检查 `durability` |

## 下一步 {#next}

- [Volume 与 Transfer](/integrate/native-api/volumes-transfers)
- [Workspace 生命周期](/guide/workspace-lifecycle)
- [安全模型](/security/overview)
