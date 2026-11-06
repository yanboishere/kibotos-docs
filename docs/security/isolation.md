---
title: 隔离与网络安全
description: MicroVM 计算隔离、guest 内的权限、资源上限、网络策略与永远拒绝的地址、DNS、访问 guest 内服务与公开 URL 的安全特性。
---

# 隔离与网络安全

本页说明 Kibotos 怎样把 Workspace 里运行的代码与宿主、其他 Workspace、平台内部网络隔离开，以及接入方访问 guest 内服务时各条路径的安全特性。

## 计算隔离 {#compute}

- **每个 Workspace 一台 MicroVM。** guest 有自己的内核与根文件系统，不与宿主或其他 Workspace 共享内核。后端为 Firecracker 或 KiboVM。
- **VMM 以非特权账户运行。** 宿主上的 VMM 以专用的系统账户运行（Firecracker 由 jailer 降权），文件与设备访问由各后端自己的沙箱限制。
- **默认没有嵌套虚拟化。** 两种后端默认都向 guest 隐藏 CPU 的硬件虚拟化扩展，Workspace 里不能再运行 KVM。
- **资源有上限。** 内存按请求值分配；vCPU 数按请求的毫核向上取整。guest 内的进程总数与内存都有预留与上限，一个失控的进程不会拖垮整个 guest，见下文。

### guest 内的资源上限 {#guest-limits}

| 资源 | 规则 |
|---|---|
| 进程与线程 | 全部受管进程合计可用的任务数比内核上限少 `256 + 32 × CPU 数`；每个启动的进程连同后代、以及桌面，最多用其中的 3/4 |
| 内存 | 全部受管进程合计可用的内存比 guest 可用内存少 1/16（在 64 MiB 与 256 MiB 之间），留给 guest 程序与内核；用满时内核结束其中占用最多的进程 |
| 内存饱和 | 进程持续卡在内存上限（最近 60 秒内全部进程同时停滞的时间达到 25%）满 2 分钟且确实撞到上限时，guest 杀掉其中常驻内存最大的受管进程；guest agent 与平台进程不在选择范围内 |

详见[数据面：文件与进程](/integrate/native-api/data-plane#guest-limits)与[运行状况观测](/integrate/native-api/observability#memory-saturation)。

## guest 内的权限 {#guest-privileges}

- 受管进程默认以 Template 声明的账号运行（内置 Template 是 `user`，uid 1000）。请求里把 `user` 设为 `root` 即以 root 运行。
- 内置的 `kibotos-coding`、`kibotos-desktop`、`kibotos-memoh` 为 `user` 配置了免密 `sudo`。
- 因此，**拿到 `PROCESS` scope 的调用方，以及在 Workspace 里运行的 Agent，可以完全控制这台 guest**。隔离边界是 MicroVM 本身，而不是 guest 里的账号。
- guest 每次启动重写 `/etc/hostname`、`/etc/hosts` 与 `/etc/resolv.conf`，在 guest 里对它们的修改不跨启动保留。
- 桌面型 Template 里的 Chromium 保留浏览器自身的沙箱。

## 网络隔离 {#network}

### 默认策略 {#default-policy}

| 接入方式 | 新建 Workspace 的默认网络 |
|---|---|
| 原生 API、`kibo` | `DENY_ALL`：没有任何出站，DNS 查询立即失败 |
| E2B SDK | SDK 默认发送 `allowInternetAccess: true`，即开放公网；不需要联网时显式设为 `false` |

`PUBLIC_INTERNET` 放行的是 guest 发起的 TCP 连接与 `ping`，可以用 `allow`、`deny` 按地址或网段收窄。访问 guest 内服务的方式见[访问 guest 内的服务](#service-access)。

### 永远拒绝的目的地 {#hard-deny}

下面的地址在任何策略下都不能从 guest 直接访问，`allow` 也放不开。被拒绝的连接立即失败，不会等到超时。

| 地址族 | 网段 |
|---|---|
| IPv4 | `0.0.0.0/8`、`10.0.0.0/8`、`100.64.0.0/10`、`127.0.0.0/8`、`169.254.0.0/16`、`172.16.0.0/12`、`192.0.0.0/24`、`192.0.2.0/24`、`192.168.0.0/16`、`198.18.0.0/15`、`198.51.100.0/24`、`203.0.113.0/24`、`224.0.0.0/4`、`240.0.0.0/4` |
| IPv6 | `::/128`、`::1/128`、`::ffff:0:0/96`、`64:ff9b::/96`、`100::/64`、`2001:db8::/32`、`fc00::/7`、`fe80::/10`、`ff00::/8` |

此外，每台 node 还拒绝它自己的管理网段、上联网段与 guest 地址池。效果是：

- guest 访问不到云厂商的元数据服务（位于 `169.254.0.0/16`）；
- guest 访问不到平台内部与宿主网络；
- 不同的 Workspace 之间不能直接互访。

只有经调用方的 Egress 离开的连接例外：它们从你的网络出去，可以访问你网络里的私有地址，见下文。

### DNS {#dns}

- guest 只向自己链路上的一个地址发 DNS 查询，`/etc/resolv.conf` 里只有这一个 `nameserver`。
- `DENY_ALL` 时查询立即失败，没有报文离开 Workspace。
- `PUBLIC_INTERNET` 时，查询转给部署的 DNS 服务器；网络策略引用了 Resolver 时转给你的 Resolver，上游不可用时返回 `SERVFAIL`，不会回退到部署的 DNS。
- guest 直接发往其他 DNS 服务器的 UDP 查询被拒绝。

详见[网络策略与 DNS](/integrate/native-api/network-policy#dns)。

### 经调用方的出口离开 {#egress}

- Egress 是你运营的 SOCKS5 端点。网络策略指定的网段里的新建 TCP 连接经它离开，可以带 TLS 与用户名口令。
- 出口失败时 guest 的连接被重置，**不会改为直连**。
- Egress 的端点地址在创建与更新时核对一次，node 每次拨号时再解析和过滤一次：端点不能落在私有或特殊用途网段，防止把出口指回平台内部。
- Egress 的口令只写，任何读取都不返回。ctrl 加密保存它；node 把它保存在只有 root 可读的目录里，只交给专用的出口进程使用，这个进程以不带任何 capability 的账户运行，文件系统只读。
- `udp_enabled` 让 `udp` Resolver 的查询经 SOCKS5 `UDP ASSOCIATE` 离开。**开启 TLS 时这些 UDP 数据报不受 TLS 保护。**

详见 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。

## 访问 guest 内的服务 {#service-access}

| 路径 | 认证 | 安全特性 |
|---|---|---|
| 服务连接（原生 API） | 会话凭证，只对申请时列出的精确端口或 socket 有效 | 不对公网开放；只连 guest 的 loopback 或受管目录下的 Unix socket |
| `kibo workspace service http` | 本机 `kibo` 的 Operator 身份 | 只监听本机 `127.0.0.1`；只接受 `Host` 为 `127.0.0.1` 或 `localhost` 的请求，挡住 DNS rebinding |
| `kibo workspace service forward` | 同上 | 只监听本机 `127.0.0.1`，但不检查经过的数据：本机任何进程（包括其他账号的）都能连这个端口；HTTP 服务请改用 `service http` |
| E2B 应用端口 | 公开 sandbox 不需要 token；私有 sandbox 需要 traffic token | 转发前去掉 traffic token、envd token、API key 与网关内部的头，应用收不到它们 |
| 公开 URL（Exposure） | 无 | 见下文 |

## 公开 URL {#exposure}

- **没有访问控制。** 地址里的随机部分是唯一的保护，拿到地址的人就能访问。不要用它发布不该公开的内容。
- **有期限。** 创建时必须给出有效期，最长 24 小时；Workspace 停止或删除时，它的全部 Exposure 一并撤销；撤销后的地址不会再分给别人。
- **独立的域名。** 平台要求 Exposure 使用专用的可注册域名，不能与控制面、数据面的域名同源，避免 Agent 产出的页面影响控制面的 cookie 作用域与同源假设。
- **只支持 HTTP。** WebSocket 与 SSE 可用；TCP、TLS 直通、UDP 与 QUIC 不在范围内。

## 下一步 {#next}

- [数据持久性与保护](/security/data)
- [网络策略与 DNS](/integrate/native-api/network-policy)
- [桌面与服务连接](/integrate/native-api/desktop-services)
