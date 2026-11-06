---
title: 应用端口与桌面
description: 通过「端口-sandboxID.域名」访问 sandbox 里的 HTTP 与 WebSocket 服务：寻址、traffic token 认证、转发行为、空闲期限、断开时机、状态码，以及桌面与 Chrome DevTools 的用法。
---

# 应用端口与桌面

本页说明怎样从外部访问 sandbox 里运行的服务：地址怎样拼、怎样认证、请求怎样转发到应用、连接什么时候断开、各状态码的含义，以及通过 6080、6081 端口使用桌面与 Chrome DevTools 的做法。读者是在 sandbox 里运行 Web 服务、预览页面或浏览器自动化的开发者。

## 寻址 {#addressing}

sandbox 里的应用端口通过下面的域名访问，与控制 API 共用同一个 HTTPS 入口：

```text
https://<port>-<sandboxID>.<domain>/
```

- `port` 是 1 到 65535 的十进制数，49983 留给 envd 协议。`sandboxID` 是 API 返回的 sandbox ID。SDK 的 `sandbox.getHost(port)` 返回这个域名。
- 请求转发到 sandbox 内 IPv4 回环地址上的对应端口。应用要监听 `127.0.0.1` 或 `0.0.0.0`；只监听 IPv6 回环地址 `::1` 的应用无法访问。
- 支持 HTTP 与 WebSocket。

在 sandbox 里启动一个 HTTP 服务，再从外部访问它：

```javascript
// 在 sandbox 里后台运行一个监听 8080 的服务
await sandbox.commands.run('python3 -m http.server 8080 --bind 0.0.0.0', { background: true, timeoutMs: 0 });

// 从外部访问；私有 sandbox 要带 traffic token
const response = await fetch(`https://${sandbox.getHost(8080)}/`, {
  headers: { 'e2b-traffic-access-token': sandbox.trafficAccessToken },
});
console.log(response.status);
```

服务刚启动时可能还没有开始监听，这时请求返回 502，稍后重试即可。

## 认证 {#authentication}

sandbox 是否需要 traffic token 由创建时的 `network.allowPublicTraffic` 决定，默认公开，见[应用端口的公开访问](/integrate/e2b/sandboxes)：

- **私有 sandbox**（创建时 `allowPublicTraffic: false`）的每个请求都要带 `e2b-traffic-access-token` 请求头，值是 `sandbox.trafficAccessToken`。
- **公开 sandbox** 可以不带 token。带了错误的 token，或同一个请求头出现多次，仍返回 401。
- API key 与 envd access token 不能代替 traffic token。
- 带了 token 却验证不通过时，网关直接返回 401，不查询 sandbox 是否存在。token 正确、或公开 sandbox 不带 token 时，sandbox 不存在返回 404。

WebSocket 客户端同样在握手请求里带这个请求头，例如用 Node.js 的 `ws` 包：

```javascript
import WebSocket from 'ws';

const ws = new WebSocket(`wss://${sandbox.getHost(8080)}/socket`, {
  headers: { 'e2b-traffic-access-token': sandbox.trafficAccessToken },
});
```

traffic token 在 sandbox 的整个生命周期内不变，`connect` 与修改到期时间都不更换它。浏览器无法给普通页面请求加请求头，需要让浏览器直接打开的服务，要么创建为公开 sandbox，要么由你自己的服务端代理请求并加上 token。

## 转发行为 {#forwarding}

### 应用收到的请求 {#request}

- 保留原始 Host、URL 路径与查询字符串、应用自己的 `Authorization` 头，以及其他端到端的请求头。
- Host 默认保留请求里的值，即 `<port>-<sandboxID>.<domain>`，与 E2B 官方实现一致，网关不会固定改写为 localhost。创建时设置了 `maskRequestHost` 时，HTTP 与 WebSocket 请求的 Host 按它改写，其中的 `${PORT}` 替换为实际端口，见[请求 Host 改写](/integrate/e2b/sandboxes)。envd 端口不受它影响。
- 网关去掉逐跳头（例如 `Connection`、`Keep-Alive`、`Transfer-Encoding`、`Upgrade`）、`Connection` 头中列出的头，以及 traffic token、envd token（`X-Access-Token`）、API key（`X-API-Key`）和网关内部的路由头。Kibotos 内部的会话凭证只用于连接 node，不会出现在应用收到的请求里。
- 只改写请求的 Host。响应体、URL 与 Chrome DevTools 的数据都不改写。
- 网关不重放请求。应用返回 401 或 403 后是否重试由调用方决定。

### HTTP {#http}

- 每个请求建立一条到 sandbox 的连接，不复用，也不重试。
- HTTP/1 请求带请求体时，上传与下载同时进行，应用可以在上传结束前返回响应（例如 401 或其他早期响应），不会因为等待请求体而僵住。背压向两端传递。
- 响应不预先声明 `Content-Length`。传输中途出错时，HTTP 响应会被截断。没有响应体的响应（`HEAD`、204、304 等）在确认连接正常结束后才发送响应头。
- 流式响应（例如 Server-Sent Events）照常逐段送达。

### WebSocket {#websocket}

- 握手与数据帧原样转发，支持文本帧与二进制帧。
- 客户端关闭写方向时，网关只关闭到 sandbox 的写方向，应用仍可以继续发送数据。
- 升级为 WebSocket 之后出错只能关闭连接，网关不会伪造关闭帧，也不会再发送 HTTP 状态码。

## 空闲期限 {#idle-timeout}

应用端口上的一条连接，两个方向都没有字节传输达到 15 分钟时，网关结束它：

- 只要有字节在传输，连接就不受这个期限影响。客户端暂停读取时，数据等它恢复读取，不会被截断。
- 上游 E2B 只在两次请求之间有空闲上限，对升级后的连接不设期限。在 Kibotos 上，15 分钟完全没有数据的 WebSocket 会被断开，需要长时间保持安静的应用要自己发送心跳，例如 WebSocket 的 ping。

## 连接断开的时机 {#disconnect}

以下事件会断开进行中的连接：客户端取消请求、sandbox 被删除、sandbox 暂停或这次执行结束、网关实例关闭，以及上一节的空闲期限。

- 网关不设置固定的连接时长上限，内部凭证到期也不会断开已建立的连接。
- 延长有效期不影响已有连接。缩短有效期后，sandbox 在到期时被删除或暂停，连接随之断开。
- `connect` 一个运行中的 sandbox 不影响已有连接，新旧 token 相同，进行中的 HTTP 与 WebSocket 继续收发。
- 网关实例关闭会断开经过它的连接。平台运营方运行多个网关实例时，客户端重新连接即可由其他实例服务。

## 状态码 {#port-status-codes}

| 情况 | 状态码 |
|---|---|
| sandbox ID 格式不合法、sandbox 不存在、属于其他部署，或端口不在 1 到 65535 之间 | 404 |
| 私有 sandbox 没有带 traffic token，token 错误或重复 | 401 |
| sandbox 已重新启动（例如暂停后恢复）或 token 已被撤销，需要调用方刷新 | 401 |
| sandbox 没有在运行，例如已暂停 | 503 |
| 查询 sandbox 状态失败，或 Kibotos 暂时不可用 | 503 |
| 连接 sandbox 内的端口失败，例如端口上没有程序在监听 | 502 |
| node 拒绝了网关的内部凭证而执行没有变化，或网关正处于重新申请凭证的等待期 | 502 |

- 只有 401 表示调用方需要刷新：先确认 token 正确，再调用 `Sandbox.connect()` 取得当前的 token。基础设施故障返回 503，不会让调用方无意义地刷新。
- node 连续拒绝凭证时，网关对这个端口重新申请凭证前先等待 1 秒，之后每次加倍，最长 30 秒，等待期间的请求直接返回 502。node 正常建立一次连接后恢复。

## 桌面与 Chrome DevTools {#desktop}

下面的说明针对 Memoh 这类通过 6080、6081 端口使用桌面与浏览器的调用方。网关只转发端口上的流量，桌面、VNC、noVNC、websockify 与浏览器都由 Template 的镜像提供，端口布局由镜像决定。桌面镜像的要求见[桌面 Template 规范](/templates/desktop)。

| 端口 | 在镜像里的角色 | 用法 |
|---|---|---|
| 6080 | noVNC 与 websockify 提供的桌面入口 | 页面地址是 `https://6080-<sandboxID>.<domain>/vnc.html`，noVNC 通过 WebSocket 连接镜像里的 VNC 服务。私有 sandbox 的页面与 WebSocket 请求都要带 traffic token，见[认证](#authentication) |
| 6081 | websockify 端口网关 | 用 `/?token=<端口>` 选择 sandbox 内的回环端口，WebSocket 二进制帧原样接到该端口，例如 `/?token=9222` 连接 Chrome DevTools |
| 9222 | Chromium 的远程调试端口（CDP） | 经 6081 访问 |

- 6081 的 `?token=9222` 是 websockify 选择目标端口的参数，不是网关的 traffic token，网关原样传递。私有 sandbox 的 6081 请求仍然要带 `e2b-traffic-access-token` 请求头。
- 网关不改写 Chrome DevTools 的发现接口（`/json/version`、`/json/list`）返回的 JSON。调用方通常经 6081 的字节桥发送原始 HTTP 请求读取发现接口，从 `webSocketDebuggerUrl` 中只取路径与查询，再经一条新的 6081 连接建立 CDP 的 WebSocket。经 6081 转发时，内层请求的 Host 是 `localhost:9222` 这样的回环地址，Chromium 会接受。
- 直接访问公开的 `9222-<sandboxID>.<domain>` 时，Chromium 可能因为 Host 不是回环地址而拒绝请求。这是 Chromium 的行为。网关默认不改写 Host。
- 镜像里没有 6081 时，调用方可以直接访问 9222 这样的端口，但不能保证 Chromium 接受。这些用法都需要用你实际使用的镜像验证。
- 以 Memoh 的桌面镜像为例：VNC 服务监听 `127.0.0.1:5999`，6080 的 noVNC 指向它，6081 的 websockify 按 `/?token=<端口>` 把连接接到回环端口，Memoh 经它访问 9222 的 CDP 与 5999 的 VNC。

原生 API 的桌面与服务连接见[桌面与服务连接](/integrate/native-api/desktop-services)。

## 相关文档 {#related}

- [sandbox 生命周期](/integrate/e2b/sandboxes)：公开访问的默认值与 `maskRequestHost`。
- [暂停与恢复](/integrate/e2b/pause-resume)：暂停时连接的去向。
- [公开 URL（Exposure）](/integrate/native-api/exposure)：原生 API 提供的公开预览地址。
- [内置 Template](/templates/builtin)
