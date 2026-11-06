---
title: 端口、公开 URL 与桌面
description: 用 kibo 在本机浏览器打开 Workspace 里的 HTTP 服务、把 TCP 端口或 Unix socket 转发到本机、发布公开 URL，以及查看桌面、截图与发送键鼠输入。
---

# 端口、公开 URL 与桌面

本页说明怎样用 `kibo` 访问 Workspace 里运行的服务：在本机浏览器打开 HTTP 服务、把任意 TCP 端口或受管 Unix socket 转发到本机、把一个 HTTP 端口发布成任何人都能打开的公开 URL，以及查看和操作桌面型 Workspace。读者是需要从工作机连到 Workspace 里服务的接入开发者。

## 概述 {#overview}

| 方式 | 谁能访问 | 协议 | 前提 |
|---|---|---|---|
| `kibo workspace service http` | 只有本机，并校验 `Host` | HTTP，含 keep-alive、SSE 与 WebSocket | 服务端宣告 `workspace.service_connection` |
| `kibo workspace service forward` | 本机上的任何进程 | 任意 TCP 字节流 | 同上 |
| `kibo exposure create` | 任何拿到 URL 的人 | HTTP，含 WebSocket 与 SSE | 部署配置了 Exposure 域名 |
| `kibo workspace desktop view` | 本机浏览器 | 桌面的 VNC，经本机 WebSocket | 桌面型 Template |

- 前三种都连到 guest 的 loopback 地址（`127.0.0.1` 或 `::1`）上的端口，服务只监听 `127.0.0.1` 也能用，不需要改成监听 `0.0.0.0`。`service forward` 另外可以连 guest 里受管目录下的 Unix socket。
- `service http`、`service forward` 与 `desktop view` 经数据面连接，使用只对这个目标有效的会话凭证，由 `kibo` 自动申请并在到期前换新，不需要 token 或域名，也不对公网开放。
- 程序直接调用这些接口的方式见[桌面与服务连接](/integrate/native-api/desktop-services)与[公开 URL（Exposure）](/integrate/native-api/exposure)。

## 在本机浏览器打开 HTTP 服务 {#service-http}

`kibo workspace service http` 把 Workspace 里一个 HTTP 端口代理到本机的 `127.0.0.1`，用浏览器直接打开：

```bash
kibo workspace service http "$workspace_id" --tcp-port 5173
# URL  http://127.0.0.1:5173/
```

按 Ctrl-C 停止代理，正在进行的连接一并结束。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--tcp-port` | 必填 | 服务在 Workspace 里监听的端口 |
| `--family` | `ipv4` | 服务监听在 `::1` 时写 `ipv6` |
| `--listen-port` | 与 `--tcp-port` 相同 | 本机端口；`0` 取一个空闲端口 |

- 本机端口默认与 Workspace 里的端口相同，应用写死的 `localhost:5173` 回调地址和跨域配置照常可用。本机端口被占用时，命令在联系 ctrl 之前就以退出码 `2` 失败，换一个 `--listen-port` 即可。
- 服务可以晚于代理启动，未启动期间请求返回 `502`。
- 代理只接受 `Host` 为 `127.0.0.1` 或 `localhost` 加本机端口的请求，其他 `Host` 返回 `403`。这挡住了把别的域名解析到 `127.0.0.1` 的网页。
- 应用看到的 `Host` 就是浏览器发来的值，它生成的重定向与绝对地址会回到本机代理。keep-alive、SSE 等流式响应与 WebSocket 都可用。
- 代理同时保持最多 32 条到 Workspace 的连接，超出的请求等待空闲的连接。
- 代理可以一直开着：凭证在到期前自动换新，Workspace 重新启动后也不用重开。
- 只有这台机器能访问它。要把服务给别人看，用[公开 URL](#exposure)。

## 本机端口转发 {#service-forward}

`kibo workspace service forward` 把 Workspace 里的一个 TCP 端口或受管 Unix socket 转发到本机 `127.0.0.1` 的一个端口。它不理解应用协议，所以数据库、SSH、VNC、gRPC 这类不走 HTTP/1.1 的服务都能用本机客户端直接连：

```bash
kibo workspace service forward "$workspace_id" --tcp-port 5432
# Address  127.0.0.1:5432
psql -h 127.0.0.1 -p 5432 -U postgres
```

用原生 VNC 客户端连桌面时，转发桌面的 VNC socket：

```bash
kibo workspace service forward "$workspace_id" \
  --unix-path /run/kibotos/services/desktop/vnc.sock --listen-port 5900
```

按 Ctrl-C 停止转发，正在进行的连接一并重置。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--tcp-port` | 与 `--unix-path` 二选一 | 服务在 Workspace 里监听的端口 |
| `--family` | `ipv4` | 服务监听在 `::1` 时写 `ipv6` |
| `--unix-path` | 与 `--tcp-port` 二选一 | Workspace 里受管目录下的 Unix socket，规范的绝对路径，最长 107 字节 |
| `--listen-port` | 与 `--tcp-port` 相同；转发 Unix socket 时必填 | 本机端口；`0` 取一个空闲端口 |

- 受管目录是 guest 里的 `/run/kibotos/services`：目录与 socket 都要属于 `root:root`，socket 的权限为 `0600`，目录不能对 group 或 other 可写。不在这个目录下或属主、权限不符的 socket 以 `permission_denied` 拒绝。桌面的 VNC socket 由 guest 按这个规则创建。
- 本机每条连接对应 Workspace 里的一条连接。连上就建立，服务端先发数据的协议（MySQL、SSH、VNC）不用等客户端先写。
- 两个方向的数据原样转发，一端结束写入后另一端读到 EOF。一端不读时另一端的写入会等待，连接不会因此断开，也没有空闲超时。
- 最多同时转发 32 条连接，超出的新连接被重置。
- 连不上服务、Workspace 停止或连接中途失败时，本机连接被重置，标准错误写一行原因，例如 `connection from 127.0.0.1:52144 reset: unavailable: …`。
- 服务可以晚于转发启动。转发可以一直开着：凭证在到期前自动换新，Workspace 重新启动后也不用重开。
- 本机端口被占用时命令以退出码 `2` 失败，换一个 `--listen-port` 即可。

### 安全提示 {#forward-security}

转发不检查经过的数据，本机上任何进程都能连这个端口，包括其他账号的进程。

浏览器里的网页也能向这个端口发请求。对 HTTP 服务，网页可以借 DNS rebinding 读写它，所以 HTTP 服务请用会校验 `Host` 的 `service http`。这与 `kubectl port-forward`、`ssh -L` 的风险相同。

### 验证用的子命令 {#service-diagnostics}

`kibo workspace service` 下另有两个用于验证服务连接的子命令，参数与 `forward` 相同（`--tcp-port` 或 `--unix-path`、`--family`）：

- `service echo` 向目标发送一段二进制数据，核对原样收回，需要 guest 里有一个回显服务。
- `service bridge` 在本机 loopback 上提供一个 WebSocket 适配器与回显验证页面，`--listen-port` 与 `--origin` 设置监听端口与允许的来源。

## 公开 URL {#exposure}

`kibo exposure` 把 Workspace 内一个 HTTP 端口换成一条 `https://` 地址，任何拿到这条地址的人都能在浏览器里打开它。适用于 Agent 在 Workspace 里写出一个 Web 服务、需要直接看到它或发给别人看的场景。

```bash
kibo exposure create --workspace "$workspace_id" --port 3000 --ttl 2h
```

输出里的 `URL`（JSON 的 `result.url`）就是可以直接打开、也可以发给别人的地址：部署 Exposure 域名下的一个随机名字。它不带结尾斜杠，要访问某个路径时直接接在后面。

| 参数 | 说明 |
|---|---|
| `--workspace` | 必填，Workspace ID |
| `--port` | 必填，服务在 Workspace 里监听的 TCP 端口，1 到 65535 |
| `--ttl` | 必填，地址的有效期，例如 `2h`，最长 24 小时 |
| `--ipv6` | 服务监听在 `::1` 时加上；默认连 `127.0.0.1` |

### 注意 {#exposure-notes}

- **没有访问控制。** 拿到地址的人就能访问，没有口令、来源或 IP 限制。地址里的随机名字是它唯一的保护。不要用它公开不该被看到的东西。
- **端口在 guest 的 loopback 上读。** 服务只监听 `127.0.0.1` 也能用。
- **只能为运行中的 Workspace 创建。** Workspace 不是 `AVAILABLE` 时创建以 `failed_precondition` 失败（退出码 `13`）。
- **有效期必填，最长 24 小时。** 到期后自动停止服务。
- **停止或删除 Workspace 时，它的全部 Exposure 一并撤销。** Workspace 再次启动后要重新创建，得到的是新地址；撤销过的地址不会再分给别人。
- **协议只有 HTTP**，其中 WebSocket 与 SSE 可用。TCP、TLS 直通、UDP 与 QUIC 不在范围内。
- **取决于部署配置。** 平台运营方配置了 Exposure 域名时，ctrl 才宣告 `exposure.create`、`exposure.get`、`exposure.list`、`exposure.revoke`。没有配置时，`kibo exposure` 的命令以退出码 `14` 结束，不发请求。

### 查看与撤销 {#exposure-manage}

```bash
kibo exposure list --workspace "$workspace_id"
kibo exposure get "$exposure_id"
kibo exposure revoke "$exposure_id"
```

- `get` 显示 URL、状态（`ACTIVE` 或 `REVOKED`）、Workspace、目标端口、创建与到期时间，撤销后另有撤销时间。`list` 可以用 `--workspace` 只列一个 Workspace 的 Exposure，用 `--page-size`、`--page-token` 翻页。
- `revoke` 让地址立即停止服务，正在进行的连接一并结束。重复撤销不报错。

需要的是一条给自己程序用、不对公网开放的字节通道时，用本机端口转发或原生 API 的服务连接，见[桌面与服务连接](/integrate/native-api/desktop-services)。

## 桌面 {#desktop}

桌面型 Template（`kibotos-desktop`、`kibotos-memoh`，或按[桌面 Template 规范](/templates/desktop)构建的自定义 Template）在 Workspace 里提供一个无头 X11 桌面。`kibo` 可以在本机浏览器里查看它，也可以直接截图和发送键鼠输入。

### 在浏览器中查看桌面 {#desktop-view}

```bash
kibo workspace desktop view "$workspace_id"
# Page  http://127.0.0.1:41735/
```

在浏览器里打开输出的 `Page` 地址即可查看和操作桌面。按 Ctrl-C 关闭查看页面与它的连接。

- 它为桌面的 VNC socket（`/run/kibotos/services/desktop/vnc.sock`）申请数据面凭证，把 VNC 流量转成本机的 WebSocket 交给浏览器里的 noVNC 页面。需要服务端宣告 `workspace.service_connection`。
- 凭证在到期前自动换新，Workspace 重新启动后也会重新申请，所以页面可以一直开着，断开后在页面上重新连接即可，不需要重跑命令。
- 带按需启动标记的 Template（两个内置桌面 Template 都带）开机时桌面不运行，第一次连接会启动它。命令先连一次，在 5 秒的拨号期限内等桌面就绪，来不及时命令失败，重跑即可。
- 连接没有时长、空闲或累计流量上限，凭证过期也不会断开已建立的连接。
- Workspace 停止或删除、所在 node 重启时连接结束，页面会提示并允许重新连接。
- 一个查看命令最多同时保持 16 条连接，例如 16 个标签页，超出时新连接被拒绝。浏览器 5 秒内没有接收数据时，该连接结束。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--listen-port` | `0` | 本机端口，`0` 取一个空闲端口 |
| `--origin` | 查看页面自己的来源 | 允许连接的、精确的本机 HTTP 来源 |
| `--novnc-dir` | 按下文顺序查找 | noVNC 资产所在的目录 |

### noVNC 资产 {#novnc-assets}

查看页面里的 VNC 客户端是上游 noVNC 的 v1.6.0 版本。它**不随 `kibo` 可执行文件分发**，需要另外准备。`kibo` 按下面的顺序查找，用第一个包含全部所需文件的目录：

1. `--novnc-dir` 指定的目录。
2. 环境变量 `KIBO_NOVNC_DIR` 指定的目录。
3. `/usr/share/kibotos/novnc`。
4. 当前工作目录下的 `.cache/novnc/v1.6.0`。

所需文件是 `core/rfb.js`、`core/display.js`、`core/input/keyboard.js`、`vendor/pako/lib/zlib/inflate.js`、`LICENSE.txt` 与 `AUTHORS`。都找不到时命令以退出码 `2` 失败，错误信息列出查找过的目录，并提到源码仓库里的下载命令 `mise run novnc-fetch`。

获取方式二选一：

- 向平台运营方索取已经准备好的 noVNC 目录，放在上面任一位置。
- 按源码仓库 `build/novnc/asset-archive.json` 记录的地址与校验和自己下载：取 noVNC 的 v1.6.0 发布归档，核对 SHA-256，只解出 `core`、`vendor`、`LICENSE.txt` 与 `AUTHORS`：

::: code-group
```bash [Linux]
curl --fail --location --output novnc-v1.6.0.tar.gz https://github.com/novnc/noVNC/archive/refs/tags/v1.6.0.tar.gz
echo '5066103959ef4e9b10f37e5a148627360dd8414e4cf8a7db92bdbd022e728aaa  novnc-v1.6.0.tar.gz' | sha256sum --check
mkdir -p "$HOME/.local/share/kibo/novnc-v1.6.0"
tar -xzf novnc-v1.6.0.tar.gz -C "$HOME/.local/share/kibo/novnc-v1.6.0" --strip-components=1 \
  noVNC-1.6.0/core noVNC-1.6.0/vendor noVNC-1.6.0/LICENSE.txt noVNC-1.6.0/AUTHORS
export KIBO_NOVNC_DIR="$HOME/.local/share/kibo/novnc-v1.6.0"
```
```bash [macOS]
curl --fail --location --output novnc-v1.6.0.tar.gz https://github.com/novnc/noVNC/archive/refs/tags/v1.6.0.tar.gz
echo '5066103959ef4e9b10f37e5a148627360dd8414e4cf8a7db92bdbd022e728aaa  novnc-v1.6.0.tar.gz' | shasum -a 256 --check
mkdir -p "$HOME/.local/share/kibo/novnc-v1.6.0"
tar -xzf novnc-v1.6.0.tar.gz -C "$HOME/.local/share/kibo/novnc-v1.6.0" --strip-components=1 \
  noVNC-1.6.0/core noVNC-1.6.0/vendor noVNC-1.6.0/LICENSE.txt noVNC-1.6.0/AUTHORS
export KIBO_NOVNC_DIR="$HOME/.local/share/kibo/novnc-v1.6.0"
```
:::

把 `export KIBO_NOVNC_DIR=…` 写进 shell 的配置文件，之后的 `desktop view` 都能找到它。noVNC 的许可见解出的 `LICENSE.txt`。

### 截图与键鼠输入 {#desktop-input}

`kibo workspace desktop` 的其他子命令直接对桌面截图或发送键鼠输入。它们与浏览器中的查看页面共享同一个桌面，互不抢占。这些命令需要服务端宣告 `workspace.desktop`，每次调用申请一次 `DESKTOP` 范围的数据面凭证。

```bash
kibo workspace desktop screenshot "$workspace_id" screen.png
kibo workspace desktop move "$workspace_id" 640 360
kibo workspace desktop click "$workspace_id"
kibo workspace desktop click "$workspace_id" 640 360 --button right --count 2
kibo workspace desktop drag "$workspace_id" 100 100 400 300 --button left
kibo workspace desktop scroll "$workspace_id" --direction down --amount 3
kibo workspace desktop key "$workspace_id" ctrl+l
kibo workspace desktop type "$workspace_id" '在搜索框里输入中文 😀'
kibo workspace desktop paste "$workspace_id" "$(cat notes.md)"
kibo workspace desktop paste "$workspace_id" 'ls -la' --keys ctrl+shift+v
```

**截图**：`screenshot` 把当前画面保存为本地 PNG 文件。

- 先写到目标旁边的临时文件，写完后再替换目标。目标不能是符号链接或特殊文件；新建文件的权限为 `0600`，覆盖已有文件时保留原权限。
- 输出包含 `path`、`format`、`width`、`height`、`size_bytes` 和 `sha256`。
- 路径为 `-` 时图片写到标准输出，这时不能用 `--json`，上述信息改写到标准错误。

**键鼠输入**：其余子命令每次执行一次输入动作，成功后输出指针位置 `pointer`（`x`、`y`），人读格式为 `x,y`。

| 子命令 | 参数 | 说明 |
|---|---|---|
| `move "$workspace_id" X Y` | | 移动指针 |
| `click "$workspace_id" [X Y]` | `--button` 为 `left`（默认）、`middle` 或 `right`；`--count` 默认 1，最多 3 | 不给坐标时在当前位置点击。只给一个坐标会被拒绝 |
| `drag "$workspace_id" X1 Y1 X2 Y2` | `--button` | 按下、移动、抬起在一次调用中完成，调用结束时按键一定已释放 |
| `scroll "$workspace_id" [X Y]` | `--direction` 必填，`up`、`down`、`left` 或 `right`；`--amount` 默认 1，最多 16 | 单位是滚轮格数，坐标规则同 `click` |
| `key "$workspace_id" CHORD` | | 按键组合，用 `+` 连接，如 `ctrl+l`、`enter`，最多 8 个键 |
| `type "$workspace_id" TEXT` | | 逐字符输入 UTF-8 文本，单次最多 1024 字节 |
| `paste "$workspace_id" TEXT` | `--keys` 默认 `ctrl+v` | 把文本放入剪贴板并按下粘贴快捷键，单次最多 64 KiB |

注意：

- `key` 接受的键名：单个字符，或 `shift`、`ctrl`、`alt`、`super`、`enter`、`tab`、`escape`、`backspace`、`delete`、`insert`、`space`、`home`、`end`、`pageup`、`pagedown`、`up`、`down`、`left`、`right`、`f1` 到 `f12`。
- `type` 输入键盘布局中没有的字符（中文、emoji 等）时，会临时占用布局中空闲的键位，调用结束后恢复。每批字符都要等桌面应用重新读取布局，长文本或字符种类多的文本用 `paste` 更快。
- `paste` 把写入剪贴板和按快捷键放在一次调用里，因为桌面上任何应用复制内容都会覆盖剪贴板。桌面进程重建后剪贴板为空。终端应用通常需要 `--keys ctrl+shift+v`。
- 坐标是否在屏幕内、文本长度、键名是否可用由服务端判断。`kibo` 只检查参数格式：非数字坐标、未知按钮和方向在发请求前就被拒绝。
- 桌面还没运行时，第一次调用会启动它，并在这次调用的期限内（全局参数 `--timeout`，默认 30 秒）等它就绪；来不及时调用失败，重试即可。刚就绪的桌面可能还没画完，第一张截图里不一定有完整的桌面。

## 下一步 {#next-steps}

- [桌面 Template 规范](/templates/desktop)
- [桌面与服务连接](/integrate/native-api/desktop-services)
- [公开 URL（Exposure）](/integrate/native-api/exposure)
- [内置 Template](/templates/builtin)
