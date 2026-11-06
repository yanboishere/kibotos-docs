---
title: 桌面与服务连接
description: DesktopService 的截图与键鼠输入（动作类型、参数与上限、桌面按需启动），以及连接 guest 内 TCP 端口或 Unix socket 的服务连接：目标、WebSocket 与双向流两条路径、帧格式、关闭码与共同限制。
---

# 桌面与服务连接

本页说明数据面上的两类能力：`DesktopService` 让程序对桌面型 Workspace 截图、发送键鼠输入；服务连接把程序接到 guest 内的某个 TCP loopback 端口或 Unix socket，例如 VNC、Chrome DevTools 或应用端口。读者是构建 computer-use 类 Agent 或需要访问 guest 内服务的集成开发者。先读[数据面：文件与进程](/integrate/native-api/data-plane)了解会话凭证。

## DesktopService {#desktop}

`DesktopService` 截取 Workspace 的桌面画面，并把指针与键盘输入送到桌面。

### 前提条件 {#desktop-prerequisites}

- Workspace 使用桌面型 Template，例如内置的 `kibotos-desktop`。Template 怎样声明桌面见[桌面 Template 规范](/templates/desktop)。
- 会话凭证带 `DATA_PLANE_SCOPE_DESKTOP`。
- 服务端宣告能力名 `workspace.desktop`。
- Template 声明的默认账号在 guest 中可用。账号不可用时 `root` 照常可用，但桌面不可用，见[数据面：文件与进程](/integrate/native-api/data-plane)。

桌面与通过服务连接查看它的人共享：这些调用不会从查看者那里夺走控制，也不会把控制交给查看者，两边的输入合并到同一个桌面会话里。

### 桌面按需启动 {#on-demand}

- Template 带按需启动标记时，Workspace 开机时桌面不运行，第一次使用时才启动：一次 `Screenshot` 或 `PerformActions` 调用、一条连到桌面 VNC socket 的服务连接，或 guest 里的程序请求桌面，都会触发启动。没有这个标记的 Template 在开机时启动桌面。
- 桌面还没就绪时，调用会请求启动桌面，并在这次调用自己的期限内等待它就绪。等不到时这次调用失败（可重试的 `unavailable`，或者客户端自己的超时），重试即可，启动在后台继续。给第一次调用留出足够的期限。
- 刚就绪的桌面可能还没画完，第一张截图里不一定有完整的画面。
- 桌面一旦启动，会一直运行到 Workspace 停止。

### Screenshot {#screenshot}

`Screenshot` 的请求没有字段。响应：

| 字段 | 含义 |
|---|---|
| `format` | 图片格式，目前是 `SCREENSHOT_FORMAT_PNG` |
| `width`、`height` | 画面的宽与高，单位是像素 |
| `image` | 图片字节 |

每次返回的都是为这次调用截取的画面；截取失败时返回错误，不会拿更早的画面代替。

### PerformActions {#perform-actions}

`PerformActions` 的请求是一个有序的 `actions` 列表，每一项是一个 `DesktopAction`，在下表中选一种：

| 动作 | 字段 | 规则 |
|---|---|---|
| `move_pointer` | `position` | 把指针移到这个位置。`position` 必填 |
| `click_pointer` | `button`、`count`、`position` | 点击。`button` 为 `POINTER_BUTTON_LEFT`、`POINTER_BUTTON_MIDDLE` 或 `POINTER_BUTTON_RIGHT`；`count` 取 1 到 3，1 是单击、2 是双击、3 是三击 |
| `press_pointer` | `button`、`position` | 按下指针按键 |
| `release_pointer` | `button`、`position` | 抬起指针按键 |
| `scroll_pointer` | `direction`、`amount`、`position` | 滚动。`direction` 为 `SCROLL_DIRECTION_UP`、`SCROLL_DIRECTION_DOWN`、`SCROLL_DIRECTION_LEFT` 或 `SCROLL_DIRECTION_RIGHT`；`amount` 是滚轮格数，取 1 到 16 |
| `press_keys` | `keys` | 按一次组合键：按给出的顺序按下、再按相反顺序抬起。1 到 8 个键，键名见下文 |
| `type_text` | `text` | 逐字符输入 UTF-8 文本，不能为空，单项最多 1024 字节 |
| `write_clipboard` | `text` | 把 UTF-8 文本写进桌面剪贴板，不能为空，最多 64 KiB |
| `wait` | `duration_ms` | 等待，取 1 到 2000 毫秒 |

- `position` 是 `ScreenPosition`，以屏幕左上角为原点、单位是像素，必须在屏幕范围内。省略 `position` 的动作在指针当前所在的位置执行。
- 一个请求 1 到 64 个动作；全部 `type_text` 合计最多 4096 字节，全部 `wait` 合计最多 10000 毫秒。
- 整个请求先作为整体校验，任何一项不合法时什么都不执行，返回 `invalid_argument` 并指出是第几个动作。
- 动作按顺序送达。这次调用按下而没有抬起的键与按键，在调用结束时一律释放，调用方中途放弃时也一样：输入状态只属于一次调用，不会留到之后。
- 响应的 `pointer` 是调用结束时指针的位置。

关于文本输入：

- `type_text` 输入键盘布局里没有的字符（中文、emoji 等）时，在调用期间临时占用布局里空闲的键位，调用结束后恢复。每次改动布局都要等桌面应用重新读取，所以长文本或字符种类多的文本，用 `write_clipboard` 加一个粘贴组合键更快。
- `write_clipboard` 写入的内容只保证在同一个请求里可用：桌面上任何应用之后复制内容都会覆盖剪贴板。把写剪贴板与粘贴放在同一个请求里，例如 `write_clipboard` 之后接一个 `keys` 为 `["ctrl", "v"]` 的 `press_keys`；终端应用通常要用 `["ctrl", "shift", "v"]`。

请求示例（JSON）：点击搜索框，粘贴一段文本并回车：

```json
{
  "actions": [
    {"click_pointer": {"button": "POINTER_BUTTON_LEFT", "count": 1, "position": {"x": 640, "y": 120}}},
    {"write_clipboard": {"text": "Kibotos MicroVM workspace"}},
    {"press_keys": {"keys": ["ctrl", "v"]}},
    {"wait": {"duration_ms": 200}},
    {"press_keys": {"keys": ["enter"]}}
  ]
}
```

### 键名 {#key-names}

`press_keys` 的每个键是本接口规定的键名，不是键码，也不是命令行：

- 单个可打印的 ASCII 或 Latin-1 字符，表示这个字符本身，例如 `a`、`7`、`/`。大写与小写是不同的键。
- 下列命名的键，不区分大小写：`shift`、`ctrl`、`alt`、`super`、`enter`、`tab`、`escape`、`backspace`、`delete`、`insert`、`space`、`home`、`end`、`pageup`、`pagedown`、`up`、`down`、`left`、`right`、`f1` 到 `f12`。

`type_text` 能输入的字符更多：除控制字符外的 Unicode 字符都可以，布局里没有的字符按上文的方法临时映射。

### 错误 {#desktop-errors}

| 错误 | 含义 |
|---|---|
| `invalid_argument` | 动作不合法：缺字段、超出上限、坐标在屏幕外、键名或字符不支持 |
| `unavailable`，`retryable` 为 `true` | 桌面在这次调用的期限内没有就绪，或截取、送达失败；稍后重试 |
| `unavailable`，`retryable` 为 `false` | 这个 Workspace 没有桌面 |
| `permission_denied` | 凭证没有 `DATA_PLANE_SCOPE_DESKTOP` |

## 服务连接 {#service-connection}

服务连接把程序接到 guest 内的一个服务，传输原始字节，不理解应用协议。需要服务端宣告能力名 `workspace.service_connection`。

### 目标 {#targets}

申请会话凭证时请求 `DATA_PLANE_SCOPE_SERVICE_CONNECT`，并在 `service_targets` 中列出要连接的目标。每个目标是一个 `kibotos.service.v1.ServiceTarget`，二选一：

| 目标 | 字段 | 规则 |
|---|---|---|
| `tcp_loopback`（`TCPLoopbackTarget`） | `address_family`、`port` | guest 内 loopback 上的一个端口。`address_family` 为 `LOOPBACK_ADDRESS_FAMILY_IPV4`（`127.0.0.1`）或 `LOOPBACK_ADDRESS_FAMILY_IPV6`（`::1`）；`port` 取 1 到 65535 |
| `unix_stream`（`UnixStreamTarget`） | `path` | guest 内的一个 Unix stream socket。规范的绝对路径，最长 107 字节，不能是 `/`，不能含 NUL 与 `*`、`?`、`[`、`]` |

- 目标必须精确，不支持通配、端口范围或任意 IP。一张凭证 1 到 16 个目标，不能重复；凭证只对列出的目标有效。
- 目标列表参与幂等比较，并写进凭证本身。
- Workspace 使用的 Platform 不支持这类目标时，申请凭证返回 `unimplemented`（`CAPABILITY_UNAVAILABLE`）。
- 桌面的 VNC socket 是 `/run/kibotos/services/desktop/vnc.sock`。

之后有两条路径，语义相同，编码不同：

| | WebSocket | 双向流 |
|---|---|---|
| 入口 | `session.endpoint` 上的 `GET /v1/service` | `ServiceConnectionService/Connect` |
| 需要 | 一次普通的 WebSocket 升级 | 每一跳都是端到端的 HTTP/2 |
| 适合 | 前面有 L7 反向代理或 CDN 的部署；浏览器 | 直连或 L4 代理的部署 |

数据面前面有没有 L7 代理取决于部署，可向平台运营方确认；不确定时用 WebSocket。

### WebSocket {#websocket}

```text
GET https://node-a.example.com:18091/v1/service?tcp_family=ipv4&tcp_port=9222
GET https://node-a.example.com:18091/v1/service?unix_path=/run/kibotos/services/desktop/vnc.sock
```

地址的前半部分是 `session.endpoint`，上面的主机与端口只是示例。

- 查询参数二选一：`tcp_family`（`ipv4` 或 `ipv6`）加 `tcp_port`，或者 `unix_path`。每个参数只能出现一次，目标必须在凭证授予的列表中。
- 凭证放在 `Authorization: Bearer` 头里。浏览器不能给 WebSocket 握手设置请求头，改用子协议 `Sec-WebSocket-Protocol: kibotos-dp-credential.<凭证>`，只能给出一个这样的子协议，服务端在 101 响应里回选同一个。**不要把凭证放进查询串**：它会进入访问日志与 Referer。
- 鉴权与连接 guest 内的 socket 都在升级之前完成，所以 101 就表示 guest 内的服务已经连上。升级之前的失败是普通的 HTTP 响应，错误体与 `/v1/files` 相同；升级之后的失败只能通过关闭帧表达。
- 只接受带 WebSocket 升级的 `GET`，其他方法返回 405。

#### 帧格式 {#frames}

数据只走 binary frame，每帧的第一个字节是操作码：

| 操作码 | 方向 | 含义 |
|---|---|---|
| `0x00` | 双向 | 数据，载荷是原始字节，不能为空 |
| `0x01` | 客户端发往服务端 | 关闭写方向：之后不再发送数据。不带载荷 |
| `0x02` | 服务端发往客户端 | 对端已关闭写入，相当于 EOF。不带载荷 |

- 服务端拒绝 text frame、未知操作码、空数据帧，以及客户端发来的 `0x02`。
- 服务端只发送 `0x00` 与 `0x02`。以后新增的帧类型只发给在握手中声明支持它的客户端，所以客户端可以把其他操作码当作协议错误。
- 收到 `0x02` 只表示服务关闭了写入，不是失败。

#### 关闭码 {#close-codes}

升级之后，服务端用关闭码区分正常完成与失败：

| 关闭码 | 含义 | 关闭原因 |
|---|---|---|
| `1000` | 正常完成，两个方向都已结束 | 空 |
| 其他任何值 | 失败 | 以 Connect 错误码的小写名开头，例如 `resource_exhausted: service message size budget exhausted` |

- 只有 `1000` 表示正常完成。`1001` 在这里同样表示失败，例如 guest 内的服务重置了连接时，服务端以 `1001` 和 `unavailable` 开头的原因关闭。很多 WebSocket 库把 `1001` 当作正常结束，使用这类库时按上表自己判断。
- 失败类型看原因开头的错误码，它与双向流路径在同样情况下返回的错误码相同。错误码后面跟 `: ` 和说明；没有说明时，原因只有错误码。
- 原因最长 123 字节，超出的部分被截断。
- 目前的对应关系是：`invalid_argument` 用 `1007`；`resource_exhausted`、`permission_denied`、`unauthenticated`、`failed_precondition` 用 `1008`；`canceled`、`deadline_exceeded`、`unavailable` 用 `1001`；其余用 `1011`。判断时以原因开头的错误码为准。
- 没有收到关闭帧就断开，表示传输中断，按失败处理。

### 双向流 {#bidi-stream}

1. 向 `session.endpoint` 发起 `ServiceConnectionService/Connect`，这是 Connect 协议的双向流，基于 HTTP/2。
2. 第一条请求消息必须是 `open`，带 `target`，目标必须在凭证授予的列表中，并固定整条流的目标。服务端连上 socket 后回复一条 `connected`，之后才开始传数据。
3. 双向都用 `data` 消息传原始字节。发送 `half_close` 表示不再写入，之后不能再发送请求消息；收到 `eof` 表示对端已关闭写入。两个方向都结束后，RPC 正常完成。

### 共同规则与限制 {#limits}

- 单条消息不超过 32 KiB，超出时连接以 `resource_exhausted` 结束。
- 两个方向都结束后连接才算正常完成；没有半关闭就断开是协议错误。
- 连接 guest 内服务的期限是 5 秒，服务不存在或没有监听时连接失败。
- 每个 Workspace 同时至多 128 条服务连接，每个 node 合计至多 1024 条，超出的新连接返回 `resource_exhausted`。
- 同一个 Workspace 的全部服务连接共用每个方向的速率上限，当前为 64 MiB/s（突发 1 MiB），超过时放慢，不断开。
- 一端停止读取时，另一端的写入等待它恢复，连接不会因此结束。连接开多久由调用方决定，需要期限时自己设置。
- 凭证到期不影响已经建立的连接；凭证被撤销、Workspace 停止或重新启动时连接结束。

### 浏览器与证书 {#browser}

浏览器只信任系统根证书，而数据面证书由 Kibotos 内部的 CA 签发，所以只有当数据面前面有公共可信证书的 TLS 入口时，浏览器才能直连 WebSocket。是否有这样的入口取决于部署，可向平台运营方确认。

没有这样的入口时，用 `kibo` 在本机转接：

- `kibo workspace service http` 把 guest 里的 HTTP 服务代理到本机 loopback，浏览器直接打开。
- `kibo workspace service forward` 把 guest 里的 TCP 端口或 Unix socket 转发到本机端口，适合数据库、SSH、VNC 等非 HTTP 服务。
- `kibo workspace service bridge` 与 `kibo workspace desktop view` 在本机把连接转成 loopback 上的 WebSocket，后者直接提供桌面查看页面。

用法见[端口、公开 URL 与桌面](/integrate/kibo/services)。要把一个 HTTP 服务公开给别人访问，用 [Exposure](/integrate/native-api/exposure)。

## 相关文档 {#related}

- [数据面：文件与进程](/integrate/native-api/data-plane)：会话凭证与数据面的通用规则。
- [公开 URL（Exposure）](/integrate/native-api/exposure)：把 HTTP 端口发布为公开地址。
- [桌面 Template 规范](/templates/desktop)：自建桌面 Template 的要求。
- [端口、公开 URL 与桌面](/integrate/kibo/services)：用 `kibo` 转发端口与查看桌面。
