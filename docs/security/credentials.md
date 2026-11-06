---
title: 身份、凭证与访问控制
description: Operator 身份、注册密钥、数据面会话凭证、E2B 的 API key 与 token：各自的用途、有效期、保管方式、轮换与撤销。
---

# 身份、凭证与访问控制

本页列出接入 Kibotos 时会接触的每一种凭证：它授予什么权限、有效多久、怎样保管、泄露后怎样处理。

## 凭证一览 {#summary}

| 凭证 | 用途 | 有效期 | 谁签发 |
|---|---|---|---|
| 注册密钥 | 一次性换取 Operator 身份 | 默认 1 小时，可设 1 分钟到 24 小时；只能用一次 | 平台运营方，或已注册的 Operator |
| Operator 身份 | 原生 API 与 `kibo` 访问 ctrl 的 mTLS 客户端证书 | 30 天，剩余不到 10 天时续期 | ctrl |
| 数据面会话凭证 | 访问 node 数据面的 bearer 值 | 默认 5 分钟，最长 15 分钟；按执行签发时最长 1 小时 | ctrl |
| E2B API key | 访问 E2B 控制 API | 由平台运营方配置与轮换 | 平台运营方 |
| envd token | 访问某个 sandbox 的进程与文件 | 与 sandbox 同生命周期，可撤销 | E2B 网关按 sandbox 推导 |
| traffic token | 访问私有 sandbox 的应用端口 | 同上 | E2B 网关按 sandbox 推导 |

## Operator 身份 {#operator-identity}

Operator 身份是 ctrl 签发的客户端证书，URI 形如 `spiffe://<信任域>/operator/<id>`，私钥只在客户端生成和保存。

::: warning 权限范围
当前版本没有更细的角色：已注册的 Operator 可以调用所在部署的全部 Workspace API 与 Operator API，包括其他调用方创建的 Workspace。请把 Operator 身份当作这套部署的管理员凭证对待。
:::

### 取得 {#enroll}

1. 平台运营方（或已注册的 Operator）用 `kibo enrollment create --operator` 签发一把注册密钥，例如 `kibo enrollment create --operator billing-agent --output billing-agent.key`，通过安全渠道交给你。
2. 你用 `kibo context enroll` 或自己的程序调用 `EnrollmentService/Enroll` 换取身份，见[身份与认证](/integrate/native-api/authentication)。
3. 删除注册密钥文件。

注册密钥包含一把引导私钥和 ctrl 的服务端 CA，按凭证保管：不放进命令行参数、环境变量、日志或版本库。提供密钥时用终端无回显输入、`--key-stdin`、`--key-fd` 或 `--key-file`；`--key-file` 必须是普通文件，权限建议 `0600`，group 或 other 可读时 `kibo` 会警告。

一把注册密钥只能换取一份身份：用同一个证书请求（CSR）重发会拿回同一张证书，换一对新密钥再用返回 `already_exists`；密钥过期或被撤销时返回 `failed_precondition`。

### 保管 {#store}

- 身份保存在一个目录里（`kibo` 默认 `~/.config/kibo/context`，可用 `KIBO_CONTEXT_DIR` 指定）。目录里有私钥，只给运行它的账号读写。
- **一个程序一份身份。** 不要让几个程序、几台机器共用一个身份目录，也不要复制自己的 `kibo` 正在用的目录给程序：使用者各自续期，ctrl 只接受一个身份的当前与上一张证书，使用者超过两个时总有一个被拒绝。
- 需要更多身份时，用 `kibo enrollment create --operator` 为每个程序或同事单独签发，每份身份用不同的 ID。

### 续期 {#renew}

- 身份有效 30 天，剩余不到 10 天时续期。`kibo` 在访问 ctrl 前自动续期，也可以手动执行 `kibo context renew`；自己的程序调用 `EnrollmentService/Renew`，请求体是新私钥的 CSR。
- 长期运行的程序续期后，新请求要在出示新证书的新连接上发出。
- 身份过期或损坏后不能续期：停止使用它的程序，删除目录，用新的注册密钥重新注册。

### 撤销 {#revoke}

`kibo enrollment revoke --operator billing-agent --yes` 这样的命令立即终止一个身份：作废它尚未使用的注册密钥，拒绝之后的请求、注册与续期。撤销不影响已有的 Workspace，也不中断进行中的数据面连接，它们按各自的规则继续。

身份泄露时：

1. 撤销它。
2. 用新的注册密钥为受影响的程序重新注册。
3. 用 `RevokeWorkspaceDataPlane` 撤销相关 Workspace 已签发的会话凭证。注意它同时终止这些 Workspace 里经进程 API 启动的进程，见下文。

## 数据面会话凭证 {#session}

会话凭证是访问 node 数据面的短期 bearer 值，由持有 Operator 身份的程序用 `CreateDataPlaneSession` 申请：

| 限定 | 说明 |
|---|---|
| Workspace | 只对申请时指定的 Workspace 有效 |
| 执行代 | 只对当前这次执行有效；Workspace 重新启动后失效 |
| scope | `FILE_READ`、`FILE_WRITE`、`PROCESS`、`DESKTOP`、`SERVICE_CONNECT`，只授予申请的那些 |
| 服务目标 | `SERVICE_CONNECT` 只对申请时列出的精确 TCP 端口或 Unix socket 有效，不支持通配与端口范围 |
| 有效期 | 默认 5 分钟，最长 15 分钟；`lifetime = EXECUTION` 时绑定这次执行，最长 1 小时，Workspace 到期更早时随之结束 |

使用规则：

- 只放在 `Authorization: Bearer` 头里。浏览器发起 WebSocket 时放在 `Sec-WebSocket-Protocol: kibotos-dp-credential.<凭证>` 里。**不要放进 URL 查询串**：它会进入访问日志与 Referer。
- 当作不透明字符串：不解析、不写日志。响应里的 `session_id` 不是机密，可以记录用于关联。
- 凭证到期只影响新的请求，已建立的流继续；凭证被撤销、Workspace 重新启动时，进行中的流中断。
- 缓存凭证时，用掉约 80% 有效期（再减去最多 10% 的随机抖动）就重新申请；node 返回 `SESSION_EXPIRED` 或 `SESSION_REVOKED` 时丢弃缓存。

撤销：`RevokeWorkspaceDataPlane` 让一个 Workspace 已签发的全部会话凭证失效，进行中的数据面连接与服务连接随之中断，**并终止经进程 API 启动的全部受管进程**。停止与删除 Workspace 也会撤销它的凭证。

## E2B 的 API key 与 token {#e2b}

| 凭证 | 请求中的位置 | 授予 |
|---|---|---|
| API key | 控制 API 的请求头 | 这套 E2B 网关部署里的全部 sandbox 与 Volume |
| envd token | envd 协议请求的 `X-Access-Token` | 一个 sandbox 的进程与文件 |
| traffic token | 应用端口请求的 `e2b-traffic-access-token` | 一个私有 sandbox 的应用端口 |

- **API key 由整个部署共用**，没有团队或项目的划分。同一个 ctrl 上的多套 E2B 网关用不同的部署命名空间，彼此看不到对方的 sandbox；需要隔离的业务方，请平台运营方为它部署单独的命名空间。
- **token 不保存**，由网关密钥按 sandbox ID 推导。`connect` 与恢复返回的 token 与创建时相同。
- **API key 与 envd token 不能代替 traffic token**；带了错误的 token 时网关直接返回 401，不查询 sandbox。
- **默认公开的应用端口**：E2B 的应用端口默认不需要 traffic token。只有创建时显式设置 `allowPublicTraffic: false`，访问应用端口才必须携带 traffic token。
- basic auth 里的用户名只表示在 guest 里以哪个账号执行，不是认证凭证。

泄露时：

| 泄露的凭证 | 处理 |
|---|---|
| API key | 请平台运营方轮换 API key |
| 某个 sandbox 的 token | 请平台运营方撤销这个 sandbox 的 token（递增它的 token 代数）；之后调用方用 `connect` 取得新 token，旧 token 被所有网关实例拒绝 |
| 网关的 token 密钥 | 由平台运营方按两轮滚动的方式轮换密钥 |

## labels、annotations 与其他可见数据 {#visible-data}

下面这些内容对所有能读到对应资源的调用方可见，**不要放任何秘密**，也不要把它们当作访问控制：

- Workspace、Volume、Egress、Resolver 的 labels 与 annotations，包括 E2B sandbox 的 metadata；
- Resolver 的上游地址，包括 DNS over HTTPS 的 URL 路径；
- Egress 的地址与用户名（口令只写，不会返回）。

## 下一步 {#next}

- [身份与认证](/integrate/native-api/authentication)
- [数据面：文件与进程](/integrate/native-api/data-plane#session)
- [隔离与网络安全](/security/isolation)
