---
title: 公开 URL（Exposure）
description: 用 ExposureService 把 Workspace 内的一个 HTTP 端口发布为公开的 https 地址：创建参数、24 小时 TTL 上限、地址形式、没有访问控制、撤销时机、只支持 HTTP（含 WebSocket 与 SSE），以及依赖部署配置的能力名。
---

# 公开 URL（Exposure）

本页说明怎样把 Workspace 内的一个 HTTP 端口换成一条任何人都能在浏览器里打开的 `https://` 地址，以及这条地址的生命周期与安全边界。适用于 Agent 在 Workspace 里写出一个 Web 服务、需要让人直接看到它的场景。读者是集成开发者与安全评审人员。

## 概述 {#overview}

- Exposure 把 guest 内一个 loopback TCP 端口绑定到部署域名下的一个随机主机名，在 TTL 内对公网提供 HTTP 服务。
- 调用方不需要指定隧道、账号或证书：域名与它背后的一切由部署负责。
- 只有平台运营方为部署配置了 Exposure 专用域名时，这项功能才可用，见[能力名](#capabilities)。

::: danger
Exposure 没有任何访问控制。拿到地址的人就能访问，没有口令、来源或 IP 限制；地址里的随机部分是它唯一的保护。不要用它公开不该被看到的内容，用完立即撤销。
:::

## 前提条件 {#prerequisites}

- 服务端宣告能力名 `exposure.create`。
- Workspace 处于 `AVAILABLE`。
- Workspace 使用的 Platform 支持 TCP loopback 服务连接。不支持时创建返回 `failed_precondition`，`reason` 为 `CAPABILITY_UNAVAILABLE`。
- guest 里的服务监听在 `127.0.0.1` 或 `::1` 上即可，不需要改成监听 `0.0.0.0`。

## 创建 {#create}

`CreateExposure` 的请求字段：

| 字段 | 说明 |
|---|---|
| `metadata.command_id` | 幂等键。重发返回同一条 Exposure，主机名不变 |
| `workspace_id` | 目标 Workspace |
| `spec.target` | 一个 `kibotos.service.v1.ServiceTarget`，只接受 `tcp_loopback`：`address_family` 为 `LOOPBACK_ADDRESS_FAMILY_IPV4` 或 `LOOPBACK_ADDRESS_FAMILY_IPV6`，`port` 取 1 到 65535。`unix_stream` 返回 `invalid_argument` |
| `spec.ttl` | 必填，大于 0，最长 24 小时。没有不限期的 Exposure |

请求示例（JSON），公开 guest 里监听在 `127.0.0.1:3000` 的服务 2 小时：

```json
{
  "metadata": {"command_id": "agent-42-preview-3000"},
  "workspace_id": "ws-01k6...",
  "spec": {
    "target": {"tcp_loopback": {"address_family": "LOOPBACK_ADDRESS_FAMILY_IPV4", "port": 3000}},
    "ttl": "7200s"
  }
}
```

- 部署没有配置 Exposure 域名时，创建返回 `failed_precondition`，`reason` 为 `CAPABILITY_UNAVAILABLE`。
- Workspace 不是 `AVAILABLE` 时返回 `failed_precondition`，`reason` 为 `CONFLICT`。
- 响应是一个 `Exposure`，见下文。

## 地址 {#address}

| 字段 | 含义 |
|---|---|
| `exposure_id` | Exposure ID |
| `workspace_id` | 所属的 Workspace |
| `spec` | 创建时的目标与 TTL |
| `hostname` | `<随机标签>.<部署域名>`。随机标签有 128 位随机性，不由任何 ID、端口或序号推出 |
| `url` | 由 `hostname` 得到的 `https://` 地址，不带结尾的 `/`；访问某个路径时直接接在后面 |
| `state` | `EXPOSURE_STATE_ACTIVE` 或 `EXPOSURE_STATE_REVOKED` |
| `created_at`、`expires_at` | 创建时间与到期时间 |
| `revoked_at` | 只在 `state` 为 `REVOKED` 时有值 |

- 直接使用 `url`，不要自己拼接协议或端口。
- 主机名在创建时确定，这条 Exposure 的记录里一直不变；撤销之后这个主机名不会再分给任何人。

## 访问行为 {#access}

- **只支持 HTTP**，其中 WebSocket 与 SSE 可用。TCP、TLS 直通、UDP 与 QUIC 不在范围内。
- guest 里的服务看到的 `Host` 就是 Exposure 的主机名，所以它生成的绝对链接与重定向在外部也能用。请求里的 `X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Forwarded-For` 等转发头在送达 guest 之前被去掉。
- 主机名不存在、已撤销、已到期，或所属的 Workspace 已删除时，返回同一个 404 响应，四种情况无法区分。
- Exposure 有效，但 guest 里的服务没有接受连接时，返回 502。服务可以晚于 Exposure 启动，启动之前的请求得到 502。
- 并发连接数与单条连接有上限。并发数用满时，新连接返回 429（单条 Exposure 或单个 Workspace 用满）或 503（网关整体用满）；单条连接超过空闲期限、最长时长或传输总量时被结束。下表是默认值，其中空闲期限与最长时长取决于部署配置，可向平台运营方确认：

| 项 | 默认值 |
|---|---|
| 单条 Exposure 的并发连接 | 64 |
| 单个 Workspace 的并发连接 | 128 |
| 单条连接两个方向都没有数据的空闲期限 | 15 分钟 |
| 单条连接的最长时长 | 24 小时 |
| 单条连接每个方向的传输总量 | 16 GiB |

## 生命周期 {#lifecycle}

Exposure 只有两个状态：`ACTIVE` 与 `REVOKED`。下面任何一种情况都会让它进入 `REVOKED`，地址立即停止服务，正在进行的连接一并结束：

- 调用 `RevokeExposure`。
- TTL 到期。
- 所属的 Workspace 停止，包括到期停止与强制停止。
- 所属的 Workspace 被删除。

::: warning 注意
Workspace 停止再启动之后，原来的 Exposure 已经被撤销。它的记录仍然保留原来的主机名，但地址不再提供服务；要继续公开服务，在 Workspace 再次 `AVAILABLE` 之后新建一条 Exposure，新地址与原来的不同。
:::

## 查询与撤销 {#get-list-revoke}

| 方法 | 说明 |
|---|---|
| `GetExposure` | 按 `exposure_id` 读取一条 Exposure |
| `ListExposures` | 分页列出 Exposure。`workspace_id` 留空时列出全部；给出时只列这个 Workspace 的，包括已撤销的 |
| `RevokeExposure` | 字段是 `metadata.command_id` 与 `exposure_id`。撤销立即生效，结束正在进行的连接。重复撤销已撤销的 Exposure 照常成功，原样返回它 |

分页规则见[调用约定](/integrate/native-api/conventions)。

## 能力名 {#capabilities}

`exposure.create`、`exposure.get`、`exposure.list`、`exposure.revoke` 只在部署配置了 Exposure 域名时出现在 `GetServerInfo` 里。没有这些能力名时，不要向用户展示公开链接相关的功能；需要把服务给自己的程序用时，改用不对公网开放的[服务连接](/integrate/native-api/desktop-services)。

## 安全建议 {#security}

- TTL 设到够用为止，用完立即 `RevokeExposure`。
- 只公开预览或演示内容。需要鉴权的服务由服务自己做鉴权，Exposure 不会替你做。
- 把 `url` 当作敏感信息对待：只发给需要的人，不写进公开的日志或工单。
- 需要只让自己访问时，用 `kibo workspace service http` 在本机打开，见[端口、公开 URL 与桌面](/integrate/kibo/services)。

## 相关文档 {#related}

- [桌面与服务连接](/integrate/native-api/desktop-services)：需要凭证、不对公网开放的字节通道。
- [Workspace](/integrate/native-api/workspaces)：停止与删除会撤销 Exposure。
- [隔离与网络安全](/security/isolation)：网络边界与公开访问的风险。
- [端口、公开 URL 与桌面](/integrate/kibo/services)：用 `kibo exposure` 完成同样的操作。
