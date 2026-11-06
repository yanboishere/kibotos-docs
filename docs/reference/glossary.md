---
title: 术语表
description: Kibotos 文档中的术语、对应的英文与代码写法，以及一句话定义。
---

# 术语表

本页列出文档中使用的术语、对应的英文或代码写法与一句话定义。概念之间的关系见[核心概念](/guide/concepts)。

## 资源与组件 {#resources}

| 术语 | 英文 / 代码 | 定义 |
|---|---|---|
| Workspace | Workspace，`workspace_id` | 一个 Agent 运行环境的长期对象，每次启动得到一台 MicroVM |
| sandbox | sandbox | E2B 兼容 API 对 Workspace 的称呼；sandbox ID 就是 Workspace ID |
| Instance | Instance，`instance_id` | Workspace 某一次启动在某台 node 上创建的 MicroVM 及其资源 |
| 执行代 | generation | Workspace 每次启动得到的新一轮执行；会话凭证绑定在执行代上 |
| Template | Template，`template_id` | Workspace 的只读根文件系统与运行声明；E2B 创建请求里的 template 就是 Template ID |
| revision | revision | Template 或 Platform 的一个不可变版本 |
| 默认 revision | default | 某个 Template 当前选中的 revision，创建时不指定 revision 就用它 |
| Platform | Platform | guest 内核、guest agent 与 VMM 运行时的组合，按后端分为 Firecracker 与 KiboVM |
| Launch | Launch | 一次启动使用的 Template revision 与 Platform revision 组合 |
| Volume | Volume，`volume_id` | 独立于 Workspace 的持久块存储，默认挂在 `/data` |
| 可写层 | writable layer | 根文件系统之上属于某个 Workspace 的可写部分 |
| 保留的可写层 | retained layer | Workspace 停止后尽力保留在 node 上的可写层 |
| 存储池 | storage pool | node 存放 Volume 与保留的可写层的位置，由平台运营方管理 |
| Transfer | Transfer，`transfer_id` | 把 Volume 内容导出成归档、再导入成新 Volume 的过程与对象 |
| Exposure | Exposure，`exposure_id` | 把 Workspace 内的 HTTP 端口发布成公开 `https://` 地址的对象 |
| Egress | Egress，`egress_id` | 调用方运营的 SOCKS5 出口端点，被网络策略引用 |
| Resolver | Resolver，`resolver_id` | 调用方选定的 DNS 上游，被网络策略引用 |
| ctrl | ctrl | 控制面服务：权威状态、命令执行、调度、到期、签发会话凭证 |
| node | node | 运行 MicroVM 并提供数据面入口的宿主 |
| guest | guest | MicroVM 里运行的系统与 agent |
| VMM | VMM | 宿主上运行一台 MicroVM 的进程（Firecracker 或 KiboVM） |
| E2B 网关 | `kibotos-e2b` | 把 E2B 控制 API 与 envd 协议翻译成原生 API 的无状态服务 |
| Exposure 网关 | `kibotos-gw` | 服务公开 URL 的网关 |

## 访问与认证 {#access}

| 术语 | 英文 / 代码 | 定义 |
|---|---|---|
| 控制面 | control plane | ctrl 的 API 入口，mTLS 认证 |
| 数据面 | data plane | node 上直接服务文件、进程、桌面与服务连接的入口 |
| Operator | Operator | 持有 ctrl 签发的客户端身份、可以调用 Workspace API 与 Operator API 的使用者或程序 |
| 身份 | identity | ctrl 签发的客户端证书及其信任锚，保存在 context 目录 |
| 注册 | enrollment，`kibo context enroll` | 用一次性注册密钥换取正式身份的过程 |
| 注册密钥 | enrollment key | 一次性、有有效期的密钥，以 `kek1.` 开头 |
| context 目录 | context | `kibo` 保存 ctrl 地址与身份的目录，默认 `~/.config/kibo/context` |
| 会话凭证 | data-plane session credential | 访问数据面时携带的短期 bearer 值 |
| scope | scope | 会话凭证授予的权限：`FILE_READ`、`FILE_WRITE`、`PROCESS`、`DESKTOP`、`SERVICE_CONNECT` |
| 服务连接 | service connection | 把调用方的字节流接到 guest 内 TCP loopback 端口或 Unix socket 的通道 |
| API key | API key | E2B 控制 API 的凭证，由整个网关部署共用 |
| envd token | envd access token，`X-Access-Token` | 访问某个 sandbox 进程与文件的 token |
| traffic token | `e2b-traffic-access-token` | 访问私有 sandbox 应用端口的 token |
| 部署命名空间 | namespace | 区分同一 ctrl 上多套 E2B 网关部署的名字，各自看不到对方的 sandbox |

## 操作语义 {#semantics}

| 术语 | 英文 / 代码 | 定义 |
|---|---|---|
| 幂等键 | command ID，`command_id`，`--command-id` | 客户端为每个写操作生成的稳定标识；同一个键加同样的输入只执行一次 |
| 版本校验 | expected revision，`expected_revision` | 写操作附带的期望版本，与当前版本不一致时服务端拒绝 |
| 能力名 | capability | 服务端在 `GetServerInfo` 里宣告的功能名，例如 `workspace.stop.force` |
| 调度 | placement | ctrl 把 Workspace 分配到某台 node |
| 持有执行 | holds execution | Workspace 在某台 node 上还有没释放的 Instance 与资源预留 |
| 正常停止 | normal stop | 等 guest 同步文件系统后再停止 Instance |
| 强制停止 | force stop，`STOP_MODE_FORCE` | 不等 guest 停止写入就停止 Instance，最后的写入可能丢失 |
| 冷暂停 | cold pause | E2B 的暂停：停止执行，恢复时冷启动，不保留内存与进程 |
| 到期 | expiration | 到期时间与到期动作（`stop` 或 `delete`），由 ctrl 执行 |
| 落盘确认 | durability | 停止是否确认写入已到存储：`STOP_DURABILITY_CONFIRMED` 或 `STOP_DURABILITY_UNCONFIRMED` |
| 观测 | observation | node 与 guest 报告的运行状况，例如 `guest_observation`，不改变 Workspace 状态 |
| 宽限期 | drain，`drain_seconds` | 网络走向改变后，旧连接继续传输的时间 |
| 网络策略 | network policy | Workspace 的出站规则：mode、`allow`、`deny`、`egresses`、`resolvers` |
| 正在进行的 | in-flight | 尚未完成的命令、传输或执行 |
| labels | labels | 可以按它筛选的调用方键值数据 |
| annotations | annotations | 原样存取、不能筛选的调用方键值数据 |
| 平台运营方 | — | 运营你所接入的 Kibotos 部署的团队 |

## 下一步 {#next}

- [核心概念](/guide/concepts)
- [限制与默认值](/reference/limits)
