---
title: 版本状态与支持范围
description: Kibotos v0.3.0 的成熟度、兼容承诺、E2B 兼容状态、运行平台，以及当前暂不提供的能力。
---

# 版本状态与支持范围

本页说明 Kibotos 当前版本的成熟度、承诺范围与已知边界，供技术负责人评估接入风险时参考。

## 当前版本 {#current}

| 项 | 状态 |
|---|---|
| 版本 | v0.3.0 |
| 阶段 | 0.x。项目自述尚未达到生产就绪，接入前请结合本页列出的边界评估 |
| 兼容承诺 | 从 v0.1.0 起，承诺范围内的接口有兼容承诺；不兼容的变化至少保留一个 MINOR 版本的过渡期，见[兼容策略](/releases/compatibility) |
| 虚拟化后端 | Firecracker 与 KiboVM 都是正式后端，各自维护运行与验收记录 |
| guest 架构 | `linux/amd64`（x86_64） |

## 承诺范围 {#commitment}

| 面 | 是否在承诺范围内 |
|---|---|
| 原生 API：`kibotos.ctrl.v1`、`kibotos.operator.v1`、`kibotos.enrollment.v1` | 是 |
| 数据面：会话凭证的取得与使用、`/v1/files`、公开的 WebSocket 流入口、`kibotos.service.v1` | 是 |
| E2B 兼容 API | 以官方 E2B SDK 可见的入参、出参与错误码为准，见下文 |
| `kibo` 的参数与输出 | 否，随版本变化；变化写在[变更记录](/releases/changelog)里 |
| Go 生成代码（`gen/go`）的包路径与签名 | 否。建议从 proto 自行生成客户端 |

## E2B 兼容状态 {#e2b}

- 兼容目标：官方 JavaScript SDK `e2b@2.49.1`。
- 已验收的基线：`e2b@2.46.1`。`2.49.1` 的验收结论尚未取得。
- 其他语言的官方 SDK 走同一套 HTTP 与 envd 协议，但未经验收。
- 暂停与恢复的接口可用，内部是冷暂停与冷启动恢复：内存、进程与原有连接不保留。

明确不支持的接口与选项见[与 E2B 的差异](/integrate/e2b/differences)。

## 暂不提供的能力 {#not-provided}

下面的能力在 v0.3.0 中没有提供。经 E2B 兼容 API 请求它们时，网关返回 HTTP 501，SDK 抛出带能力名的错误，不会静默忽略。

| 能力 | 现状 |
|---|---|
| 内存快照与内存现场恢复 | 暂停是冷暂停，恢复时重新启动 |
| 完整磁盘快照、sandbox 克隆（fork）、从快照创建 | 不支持 |
| 应用端口访问时自动唤醒（`autoResume`） | 不支持 |
| 按域名的出网白名单、出网规则（`rules`） | 只支持地址与 CIDR |
| 创建时设置环境变量（`envVars`）、MCP 配置、IAM（`iam`） | 不支持 |
| 团队与团队级指标 | E2B 网关的 API key 由整个部署共用，没有团队 |
| 递归的目录监视 | 只支持监视一层目录 |
| 面向终端用户的自助 Template 构建 | 不提供，自定义 Template 由持有 Operator 身份的一方构建并发布，见[自定义 Template](/templates/custom) |
| 细粒度的访问角色 | 已注册的 Operator 对所在部署拥有完整管理权限 |

## 因部署而异的能力 {#deployment-dependent}

下面的能力是否可用、默认值是多少，取决于平台运营方的部署配置。原生 API 的调用方通过能力名判断，E2B 的调用方根据 501 判断；具体情况可以向平台运营方确认。

| 能力 | 取决于 |
|---|---|
| 公开 URL（Exposure） | 是否配置了 Exposure 域名；没有时不宣告 `exposure.*` 能力 |
| E2B sandbox 指标 | 是否接入实例指标存储；没有时指标接口返回 501 |
| 公网访问、IPv6 出网 | node 的网络配置 |
| 目的地规则、Egress、Resolver | node 是否支持；创建或启动时没有支持的 node 返回 `CAPABILITY_UNAVAILABLE` |
| E2B 的默认资源与最长有效期 | 网关配置，默认 1 核、1 GiB 内存、5 GiB 可写空间，默认有效期 1 小时 |
| Transfer 归档的保留期与大小上限 | 默认 24 小时、1 GiB |
| 可用的 Template 与 revision | 平台运营方发布与批准的内容 |
| 嵌套虚拟化 | 默认 guest 看不到硬件虚拟化扩展，Workspace 里不能再运行 KVM |

## 客户端平台 {#client-platforms}

| 客户端 | 支持情况 |
|---|---|
| `kibo` Linux x86-64 | 发布包提供 |
| `kibo` macOS（Apple Silicon、Intel） | 发布包提供，与 Linux 版出自同一次构建；只核对了构建身份，没有在 macOS 上做运行验收 |
| E2B JavaScript SDK | 验收口径，见上文 |
| 原生 API | 任何支持 Connect、gRPC 或 gRPC-Web 协议与 mTLS 的语言 |

## 下一步 {#next}

- [兼容策略](/releases/compatibility)
- [变更记录](/releases/changelog)
- [与 E2B 的差异](/integrate/e2b/differences)
