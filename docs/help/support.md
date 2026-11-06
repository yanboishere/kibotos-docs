---
title: 获取支持
description: 向平台运营方报告问题时需要准备的信息、怎样收集，以及不应发送的内容。
---

# 获取支持

遇到问题时，先按[常见问题排查](/integrate/troubleshooting)自查。需要平台运营方协助时，通过你与平台运营方约定的支持渠道提交问题，并按本页准备信息，这能大幅缩短定位时间。

## 需要准备的信息 {#checklist}

| 信息 | 用途 | 怎样获得 |
|---|---|---|
| 接入方式 | 区分 E2B 网关、原生 API 与 `kibo` 的路径 | — |
| 服务端版本 | 确认行为所在的版本 | `kibo version`；原生 API 的 `GetServerInfo` 返回 `source_revision` |
| 客户端版本 | 确认客户端行为 | `kibo version --client`；E2B SDK 的包版本 |
| Workspace ID / sandbox ID | 定位对象 | 创建响应；`kibo workspace list` |
| 幂等键（命令 ID） | 定位一次具体的写操作 | 你保存的 `command_id`；`kibo` 写命令输出的 `Command ID` 或 JSON 的 `command_id` |
| 会话 ID | 定位数据面请求 | `CreateDataPlaneSession` 响应的 `session.session_id`（它不是机密） |
| 发生时间 | 对照平台日志 | 精确到秒，注明时区 |
| 错误信息 | 判断原因 | Connect 错误码与 `ErrorDetail`（`reason`、`stage`、`retryable`、`message`）；E2B 的 HTTP 状态码与响应体；`kibo --json` 输出的 `error` 字段 |
| Workspace 当时的状态 | 判断所处阶段 | `kibo --json workspace get` 的输出，包括 `failure`、`last_stop`、`guest_observation` |
| 复现步骤 | 复现问题 | 最小的请求序列或脚本 |

## 收集方法 {#collect}

下面的命令收集服务端版本与一个 Workspace 的完整状态，输出里不含凭证：

```bash
kibo --json version > kibotos-version.json
kibo --json workspace get "$workspace_id" > workspace.json
kibo --json workspace cleanup-status "$workspace_id" > cleanup.json
```

写命令的结果未知时，附上命令结果的查询：

```bash
kibo --json workspace command get "$workspace_id" "$command_id" > command.json
```

## 不要发送的内容 {#do-not-send}

下面这些是凭证，任何时候都不要放进工单、聊天、邮件或截图：

- Operator 身份目录里的私钥（`identity-*.key`）与整个 context 目录；
- 注册密钥（以 `kek1.` 开头）；
- 数据面会话凭证（`credential` 字段，或 `Authorization: Bearer` 后面的值）；
- E2B 的 API key、envd token（`X-Access-Token`）与 traffic token；
- Egress 的口令，以及 Workspace 里的业务密钥。

可以放心提供的标识：Workspace ID、Volume ID、命令 ID、会话 ID、Exposure ID、证书序列号。

::: tip 凭证已经泄露时
立即按[身份、凭证与访问控制](/security/credentials)撤销或请平台运营方轮换，再继续排查原来的问题。
:::

## 下一步 {#next}

- [常见问题排查](/integrate/troubleshooting)
- [错误码](/reference/errors)
- [常见问题](/help/faq)
