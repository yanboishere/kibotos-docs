---
title: 限制与默认值
description: Kibotos v0.3.0 的资源、命名、网络、数据面、E2B 网关与 kibo 的上限、默认值与时限速查表。
---

# 限制与默认值

本页汇总 Kibotos v0.3.0 中接入方会遇到的上限、默认值与时限，便于设计与排查时速查。每一项的完整语义见所链接的页面。标注「部署配置」的值由平台运营方设置，表中是默认值，实际取值可以向平台运营方确认。

## Workspace 资源 {#resources}

| 项 | 规则 |
|---|---|
| CPU | 毫核，大于 0；实例得到的 vCPU 数是毫核除以 1000 向上取整（`1500m` 得到 2 个） |
| 内存 | MiB 的整数倍，至少 128 MiB；实例得到的内存与请求值相同；上限由调度时的可用容量决定 |
| 根文件系统可写层 | MiB 的整数倍；`0` 表示由 node 的存储配置决定；创建后只能增大；其中 1 MiB 由 node 留给写满后的下一次启动 |
| `kibo` 的默认值 | CPU `1`，内存 `256MiB` |
| 资源修改生效 | 下次启动 |

详见 [Workspace](/integrate/native-api/workspaces#resources)。

## guest 内 {#guest}

| 项 | 规则 |
|---|---|
| 受管进程合计可用的任务数 | 内核上限减去 `256 + 32 × CPU 数` |
| 单个进程（连同后代）可用的任务数 | 上面总数的 3/4 |
| 受管进程合计可用的内存 | guest 可用内存减去 1/16（预留在 64 MiB 到 256 MiB 之间） |
| 内存饱和判定 | 最近 60 秒内全部进程同时停滞的时间占比达到 25% 判为饱和，降到 10% 以下解除 |
| 内存饱和处置 | 饱和持续 2 分钟、占比仍不低于 25%、且确实撞到内存上限时，杀掉常驻内存最大的受管进程；之后 60 秒冷却 |
| guest 自己复位 | 10 分钟内超过 3 次时不再重启，Workspace 进入 `FAILED`（Firecracker 后端） |

详见[运行状况观测](/integrate/native-api/observability#memory-saturation)。

## 标识与调用方数据 {#identifiers}

| 项 | 规则 |
|---|---|
| 幂等键 | 服务端要求非空，不能以保留给服务端的 `expiration/`、`host-memory/`、`guest-shutdown/` 开头；建议采用 `kibo` 使用的格式 `^[A-Za-z0-9][A-Za-z0-9._/-]*$`，1 到 128 字节 |
| label 的 key | `[前缀/]名字`：前缀是小写 DNS 子域名，最长 253；名字 1 到 63 字符，首尾为字母或数字，中间可以有 `-`、`_`、`.` |
| label 的 value | 空，或最长 63 字符，字符规则同名字 |
| labels 合计 | 全部 key 与 value 共 65536 字节 |
| annotation 的 value | 任意不含 U+0000 的 UTF-8 |
| annotations 合计 | 全部 key 与 value 共 262144 字节 |
| 保留的前缀 | `kibotos.app` 及其子域名形式，例如 `e2b.kibotos.app/` |

详见 [Workspace](/integrate/native-api/workspaces#labels-annotations)。

## 控制面 {#control-plane}

| 项 | 规则 |
|---|---|
| 请求消息大小 | `ArtifactPublicationService` 16 MiB，`EnrollmentService` 64 KiB，其他服务 4 MiB；按解压后计算，超出返回 `resource_exhausted` |
| 停止、删除、撤销数据面的等待 | 最长 1 分钟，超时返回可重试的 `unavailable`，命令继续执行 |
| 导出、导入、恢复的等待 | 最长 1 分钟，超时同上 |
| 创建、启动 | 受理即返回 |
| 列表页大小 | 默认 50 条，最多 100 条 |

## 身份与凭证 {#credentials}

| 项 | 规则 |
|---|---|
| 注册密钥有效期 | 默认 1 小时，可设 1 分钟到 24 小时；只能用一次 |
| 注册请求的 CSR | DER 编码，不超过 8 KiB |
| Operator 身份有效期 | 30 天，剩余不到 10 天时续期 |
| 同一身份同时有效的证书 | 当前与上一张 |
| 会话凭证有效期 | 默认 5 分钟，最长 15 分钟 |
| 按执行签发的会话凭证 | 最长 1 小时，Workspace 到期更早时随之结束 |
| node 校验凭证允许的时钟偏差 | 30 秒 |

详见[身份、凭证与访问控制](/security/credentials)。

## 网络策略 {#network}

| 项 | 规则 |
|---|---|
| `allow` 与 `deny` | 两张表合计最多 256 项；只用于 `PUBLIC_INTERNET` |
| 引用的 Egress | 每个策略最多 1 个，目的网段 1 到 256 项 |
| 引用的 Resolver | 每个策略最多 1 个 |
| `drain_seconds` | 0 到 3600，默认 600 |
| Egress 生效时间 | 更新后通常 30 秒内 |
| Egress 用户名、口令 | 各 1 到 255 字节，两个同时给出 |
| Egress 的 CA 证书 | PEM，最多 64 KiB |
| Resolver 的 HTTPS URL | 最多 2048 字节，必须带路径，不能带用户信息、查询串与片段 |
| DNS 查询时限 | 从收到到应答最多 4 秒；`udp` 上游 2 秒没有应答时重发一次 |
| 每个 Workspace 同时进行中的 Resolver 查询 | 最多 256 个，超出的立即回 `SERVFAIL` |
| UDP 应答大小 | 查询里 EDNS 声明的大小，没有 EDNS 时 512 字节；超出时回带 TC 位的应答 |
| 观测出现的时间 | 从故障出现到 ctrl 读得到，一般 2 分钟以内 |

详见[网络策略与 DNS](/integrate/native-api/network-policy)与 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。

## 数据面 {#data-plane}

| 项 | 规则 |
|---|---|
| 流式消息 | 单条不超过 32 KiB；流式方法需要 HTTP/2 |
| 同时存活的受管进程 | 每个 Workspace 最多 128 个 |
| 单次 `SendInput` | 最多 64 KiB |
| 已退出进程的结果 | 保留 5 分钟，期间可以续传并取得退出状态 |
| `/v1/files` 单次请求 | 最多 1 GiB |
| `/v1/files` 速率 | 64 MiB/s，突发 1 MiB |
| `/v1/files` 空闲 | 调用方 5 秒没有发送请求体（返回 408）或没有读取响应时，请求被中断；等 guest 读写文件的时间不计入 |
| 进程输出缓冲 | 每个进程每个输出通道保留最近 1 MiB |
| 全部进程的输出缓冲 | 不超过 16 MiB 与 guest 内存 1/16 中较小者 |
| 目录监视流 | 每个 Workspace 最多 64 条；每条每秒最多 1000 个事件；空闲时每 10 秒一条心跳；调用方 5 秒没有读取时结束 |

详见[数据面：文件与进程](/integrate/native-api/data-plane)。

## 公开 URL 与 Transfer {#exposure-transfer}

| 项 | 规则 |
|---|---|
| Exposure 有效期 | 必须给出，最长 24 小时 |
| Exposure 协议 | HTTP，含 WebSocket 与 SSE |
| Transfer 归档保留期 | 默认 24 小时（部署配置） |
| 单个 Transfer 归档 | 默认最多 1 GiB（部署配置） |

## E2B 兼容网关 {#e2b}

| 项 | 规则 |
|---|---|
| 默认有效期 | 1 小时（部署配置） |
| 单次请求的最长有效期 | 默认不限制（部署配置）；`create` 与 `connect` 超过时返回 400 |
| `refreshes` 下限 | 15 秒 |
| 默认资源 | 1 核、1 GiB 内存、5 GiB 根文件系统可写空间（部署配置） |
| 每个 sandbox 的 Volume | 最多 1 个 |
| 进程与文件接口的请求消息 | 每条最多 4 MiB（按解压后计），单次 `sendStdin` 超过约 3 MiB 要分几次发送 |
| 控制 API 的请求体 | 最多 1 MiB（创建、到期、暂停、修改网络、创建 Volume） |
| 进程流自动续传 | 最多重试 30 秒；超过保留的 1 MiB 输出时以 `data_loss` 结束 |
| 出网条目 | `allowOut` 与 `denyOut` 合计最多 256 项，网关补上的 `::/0` 也计入 |
| 修改网络的等待 | 最多 30 秒确认新策略生效 |
| 应用端口空闲 | 两个方向都没有字节达到 15 分钟时断开 |
| metadata 与选项 | labels 合计 65536 字节，annotations 合计 262144 字节 |
| sandbox 指标采样 | 每 5 秒一次；默认查询延迟 30 秒（部署配置） |
| 批量指标查询 | `sandbox_ids` 最多 100 个，不能重复 |
| `egressProxy` 用户名、口令 | 各最多 255 字节 |

详见 [E2B 兼容 API](/integrate/e2b/overview)。

## kibo {#kibo}

| 项 | 规则 |
|---|---|
| 单次请求超时 `--timeout` | 默认 30 秒；文件上传下载不受它限制 |
| 等待完成 `--wait-timeout` | `workspace create/start/stop/delete` 与 `transfer restore` 默认 1 小时；`transfer export/import` 默认 2 小时 |
| `exec`、`terminal` 的自动续传 | 最多 30 秒 |
| `file put`、`file get` 单个文件 | 最多 1 GiB（每个文件一次 `/v1/files` 请求，不分段） |
| 文件传输停滞 | 连续 1 分钟没有收发数据时失败 |
| `service forward` 同时转发的连接 | 最多 32 条 |
| `desktop view` 同时连接 | 最多 16 条；拨号期限 5 秒 |
| `desktop type` | 单次最多 1024 字节 |
| `desktop paste` | 单次最多 64 KiB |

详见 [kibo 命令参考](/reference/kibo-cli)。

## 下一步 {#next}

- [错误码](/reference/errors)
- [能力名清单](/reference/capabilities)
