---
title: 桌面 Template 规范
description: 让 Template 提供无头 X11 桌面：/etc/kibotos/desktop.json 的字段、按需启动标记与两种启动时机、第一次使用的三种触发方式、运行时路径、桌面会话的账号、镜像要求与自检。
---

# 桌面 Template 规范

本页规定一个 Template 怎样提供桌面：声明文件的字段、桌面什么时候启动、怎样请求它、guest 把显示与 VNC 放在哪里、会话以哪个账号运行，以及镜像要满足的要求和怎样自检。读者是构建桌面 Template 的人，以及需要在 Workspace 里驱动桌面程序的接入开发者。查看与操作桌面的命令见[端口、公开 URL 与桌面](/integrate/kibo/services)。

## 概述 {#overview}

Template 在根文件系统里放一份声明文件 `/etc/kibotos/desktop.json`，guest 读到它才提供桌面。桌面由三个组件组成，都由 guest 启动：

| 组件 | 程序 | 运行身份 |
|---|---|---|
| 显示 | Xvfb，显示 `:0`，不监听 TCP | root |
| 会话 | 声明文件里的会话程序，例如 XFCE | Template 声明的默认账号 |
| VNC | x11vnc，只在 Unix socket 上监听 | root |

```mermaid
flowchart LR
  R["第一次使用"] --> X["启动 Xvfb 并等显示就绪"]
  X --> S["以声明的账号启动会话"]
  S --> V["启动 x11vnc 并等 VNC 就绪"]
  V --> OK["桌面就绪，运行到 Workspace 停止"]
```

- Template 只负责安装软件、声明会话程序与屏幕。显示编号、X authority 文件与 VNC 的监听路径都由 guest 固定，因为服务连接的授权正是按这些对象写的。
- 桌面启动后一直运行到 Workspace 停止，关掉查看页面或断开 VNC 连接都不会停止它。任一组件退出时，guest 停掉整组桌面进程再重新拉起；连续启动失败时，重试间隔从 1 秒起逐次加倍，最长 30 秒。显示与 VNC 各自等待就绪最多 60 秒。
- 没有声明文件、声明文件无效，或 Template 没有声明默认账号时，这个 Workspace 没有桌面：连接桌面的 VNC socket 返回 `not_found`，Workspace 的文件与进程接口照常可用。
- 桌面型 Template 的定义文件要在 `guest.capabilities` 里要求 `service.unix-stream.v1` 与 `desktop.v1`，见[自定义 Template](/templates/custom#definition)。

## 声明文件 {#declaration}

`kibotos-desktop` 的声明文件：

```json
{
  "schema": "kibotos.desktop-declaration/v1",
  "session": ["/usr/bin/startxfce4"],
  "screen": { "width": 1280, "height": 800, "depth": 24 },
  "environment": { "LANG": "C.UTF-8" }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `schema` | 是 | 固定为 `kibotos.desktop-declaration/v1` |
| `session` | 是 | 会话程序的 argv。第一项是绝对路径，各项不能含 NUL。会话程序不能自己启动 Xvfb 或 x11vnc，guest 已经启动了它们 |
| `screen.width`、`screen.height` | 是 | 屏幕的宽与高，单位像素：宽 320 到 16384，高 240 到 16384 |
| `screen.depth` | 是 | 色深，`16`、`24` 或 `32` |
| `environment` | 否 | 额外传给会话的环境变量。名字不能为空、不能含 `=` 与 NUL，值不能含 NUL；不能覆盖 `DISPLAY`、`XAUTHORITY`、`HOME`、`USER`、`LOGNAME`、`PATH`、`XDG_RUNTIME_DIR`，这些由 guest 设置 |

- guest 严格解析这个文件：出现上表以外的字段（包括 `user`）时声明无效，这次启动没有桌面。文件最大 64 KiB。
- 会话以哪个账号运行不写在这里，由 Template 的 `process_defaults.user` 决定，见[桌面会话的账号](#account)。
- 内置的 `kibotos-memoh` 用同样的会话程序，屏幕为 1280×960。

## 启动时机 {#startup}

桌面什么时候启动，取决于 Template 有没有按需启动标记 `/etc/kibotos/desktop-on-demand`。它是一个普通文件，内容不读；符号链接或读不到的文件按没有标记处理。

| Template | 启动时机 |
|---|---|
| 带标记 | 第一次有人使用时才启动，开机时不运行任何桌面进程 |
| 没有标记 | 开机后立即启动，不等请求 |

- 只有能保证镜像里的脚本在使用显示之前先请求桌面的 Template 才放标记。不放标记只是多付开机时的桌面开销，不会让 X 客户端找不到显示。
- 内置的 `kibotos-desktop` 与 `kibotos-memoh` 都带标记。

## 第一次使用 {#first-use}

带标记的 Template 上，下面三种请求中的任一种第一次出现时，guest 启动桌面：

1. **连接桌面的 VNC socket。** 例如 `kibo workspace desktop view`，或 `kibo workspace service forward --unix-path /run/kibotos/services/desktop/vnc.sock`。连接在桌面就绪后才接通。
2. **桌面调用。** 截图或键鼠输入，例如 `kibo workspace desktop screenshot`。调用在它的期限内等待桌面就绪。
3. **guest 里的进程向请求入口发 POST。**

   ```bash
   curl --unix-socket /run/kibotos/desktop/request.sock -X POST http://desktop/
   ```

   请求在 X 与 VNC 就绪后返回 `ready`（会话可能还在绘制）；这一轮启动失败时立即返回 `503` 与原因；用 POST 以外的方法返回 `405`。请求入口属于 root 与声明账号的主组，权限 `0660`，只有这个账号（同组的进程）与 root 能连。

带标记的 Template 上，在 guest 里以进程方式运行的 X 客户端（例如 `xdotool`、`xdpyinfo`）连不上还没启动的桌面，要先发这个请求。从工作机这样做：

```bash
kibo workspace exec "$workspace_id" -- sh -c 'curl --silent --show-error --fail --unix-socket /run/kibotos/desktop/request.sock -X POST http://desktop/ && DISPLAY=:0 XAUTHORITY=/run/kibotos/desktop/Xauthority xdpyinfo | head -n 5'
```

## 运行时路径 {#runtime-paths}

这些路径由 guest 在每次启动桌面时创建，都在 `/run` 下，不跨停止保留：

| 对象 | 路径 | 属主与权限 |
|---|---|---|
| 显示 | `:0`，X socket 为 `/tmp/.X11-unix/X0` | |
| X authority | `/run/kibotos/desktop/Xauthority` | root 所有，声明账号的主组可读（`0640`） |
| 会话的 `XDG_RUNTIME_DIR` | `/run/kibotos/desktop/user` | 声明的账号，`0700` |
| VNC socket | `/run/kibotos/services/desktop/vnc.sock` | `root:root`，`0600`；所在目录 `0700` |
| 请求入口 | `/run/kibotos/desktop/request.sock` | root 与声明账号的主组，`0660` |
| 组件日志 | `/run/kibotos/desktop/display.log`、`session.log`、`vnc.log` | 只有 root 可读，每个最多 1 MiB |

- VNC 只在这个 Unix socket 上监听，不开 TCP 端口，以共享模式运行，多个查看者可以同时连接。VNC 本身不设密码：只有申请到指向这个 socket 的数据面会话凭证的调用方能连上它，见[桌面与服务连接](/integrate/native-api/desktop-services)。
- Xvfb 以 `-nolisten tcp` 启动，不接受 TCP 上的 X 连接。

## 桌面会话的账号 {#account}

- 会话以 Template 的 `process_defaults.user` 运行。Template 没有声明默认账号时没有桌面：桌面从不以 root 运行。声明的账号在这次启动时不可用（不存在、uid 或 gid 为 0、没有 home）时，这次启动同样没有桌面。
- 会话得到的环境：`HOME`（账号的 home）、`USER`、`LOGNAME`、`DISPLAY=:0`、`XAUTHORITY=/run/kibotos/desktop/Xauthority`、`XDG_RUNTIME_DIR=/run/kibotos/desktop/user`、`PATH`（Template 声明的值，没有声明时为默认值），再加上声明文件的 `environment`。会话在账号的 home 目录启动。
- Xvfb 与 x11vnc 以 root 运行，使用默认的 PATH `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` 查找程序，`HOME` 为 `/root`。
- 经进程接口（例如 `kibo workspace exec`）启动的程序不会自动得到 `DISPLAY` 与 `XAUTHORITY`：需要使用显示时自己设置这两个变量，以声明的账号或 root 运行，带标记的 Template 上还要先请求桌面。

## 镜像要求 {#image-requirements}

- **定义文件**：声明 `process_defaults.user`，账号的 uid、gid 固定且不为 0，有 home；`guest.capabilities` 包含 `service.unix-stream.v1` 与 `desktop.v1`。
- **程序**：`Xvfb` 与 `x11vnc` 能在默认 PATH 上找到；`session` 第一项指向的会话程序存在且可执行。验证时常用的 `xdpyinfo`、`xprop`、`xlsclients`、`xauth` 建议一起安装（Debian 的 `x11-utils` 与 `xauth`）。
- **声明与标记**：`/etc/kibotos/desktop.json` 权限 `0644`；需要按需启动时，`/etc/kibotos/desktop-on-demand` 是一个空的普通文件，权限 `0644`。
- **`/tmp/.X11-unix`**：以 root 所有、权限 `1777` 创建。guest 启动桌面时也会修正它。
- **显示只由 guest 启动**：镜像不含 init，X server 与 VNC 只由 guest 启动。会话内部的自启动项（XDG autostart）可以用，`kibotos-memoh` 就用它在会话启动时打开浏览器。VNC 只在 guest 给定的 Unix socket 上监听，不能监听 TCP 端口。
- **浏览器沙箱**：guest 内核不一定向非特权账号提供用户命名空间。使用 Debian 的 Chromium 时安装 `chromium-sandbox`，让浏览器在没有用户命名空间时由 setuid helper 提供沙箱，不要关闭沙箱运行。
- **字体**：页面或终端会显示中文与 emoji 时，安装带中文与 emoji 的字体，例如 Debian 的 `fonts-noto-cjk` 与 `fonts-noto-color-emoji`。
- **字体缓存**：构建把根文件系统里的时间戳都设为 epoch 之后 1 秒，按旧修改时间生成的 fontconfig 缓存在 Workspace 里全部失效。构建时先把字体目录的修改时间设为这个值，再重建系统缓存：

  ```bash
  find /usr/share/fonts /usr/local/share/fonts -type d -exec touch -m -d @1 {} +
  fc-cache --system-only --really-force
  ```

- `/data` 的属主、不含 init 等其他要求与普通 Template 相同，见[自定义 Template](/templates/custom)。

## 自检 {#self-check}

### 构建时 {#self-check-build}

在 Containerfile 的最后一步，以 root 运行一个离线验证脚本。静态部分核对声明与镜像：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

declaration=/etc/kibotos/desktop.json
jq -e '.schema == "kibotos.desktop-declaration/v1" and ((keys - ["schema", "session", "screen", "environment"]) | length == 0)' "$declaration" >/dev/null
session=$(jq -r '.session[0]' "$declaration")
[[ $session == /* && -x $session ]] || { echo "session program is not an executable absolute path: $session" >&2; exit 1; }
jq -e '[.session[] | test("Xvfb|x11vnc")] | any | not' "$declaration" >/dev/null
command -v Xvfb >/dev/null && command -v x11vnc >/dev/null
[[ -f /etc/kibotos/desktop-on-demand && ! -L /etc/kibotos/desktop-on-demand ]]
[[ $(stat -c '%a' /tmp/.X11-unix) == 1777 ]]
[[ ! -e /sbin/init && ! -e /usr/lib/systemd/systemd ]]
```

不使用按需启动时去掉检查标记的那一行。内置桌面 Template 的验证还会真正启动一次无头桌面，可以照着做：

1. 生成一份临时的 X authority，在一个空闲的显示号（内置 Template 用 `:99`）上以 `-nolisten tcp` 启动 Xvfb，用 `xdpyinfo` 核对尺寸与色深与声明一致。
2. 以声明的账号、在新的进程组里启动声明的会话程序，等窗口管理器在根窗口上设置 `_NET_SUPPORTING_WM_CHECK`。
3. 启动 x11vnc，只在一个 Unix socket 上监听（`-rfbport 0 -rfbportv6 0`），从 socket 读到 `RFB 003.008` 开头的握手。
4. 确认 5900、5901 与 6000 端口上没有 TCP 监听。
5. 结束这些进程，删除 socket 与 `/tmp` 下的临时文件（保留 `/tmp/.X11-unix` 目录本身），把软件版本写进 `/usr/local/share/kibotos/`。

### 运行时 {#self-check-runtime}

发布后在一个新建的 Workspace 里确认桌面可用：

```bash
kibo workspace exec "$workspace_id" -- curl --silent --show-error --fail --unix-socket /run/kibotos/desktop/request.sock -X POST http://desktop/
kibo workspace desktop screenshot "$workspace_id" screen.png
kibo workspace exec "$workspace_id" --user root -- tail -n 50 /run/kibotos/desktop/session.log
```

请求应当返回 `ready`，截图的宽高应当与声明的屏幕一致。

| 现象 | 原因与处理 |
|---|---|
| 连接 VNC socket 返回 `not_found`，guest 里没有 `/run/kibotos/desktop/request.sock` | 这个 Workspace 没有桌面：声明文件不存在或无效（字段不对、多了字段、超过 64 KiB），或 Template 没有声明可用的默认账号 |
| 请求入口返回 `503` | 这一轮启动失败，原因写在响应里。以 root 查看 `/run/kibotos/desktop/` 下的三份组件日志；guest 会按退避间隔自动重试 |
| `kibo workspace desktop view` 第一次失败 | 桌面在 5 秒的拨号期限内还没就绪，重跑命令 |
| X 客户端报无法打开显示 | 先请求桌面，再设置 `DISPLAY=:0` 与 `XAUTHORITY=/run/kibotos/desktop/Xauthority`，以声明的账号或 root 运行 |
| 截图尺寸与预期不同 | 核对声明文件的 `screen` |

## 下一步 {#next-steps}

- [端口、公开 URL 与桌面](/integrate/kibo/services)
- [桌面与服务连接](/integrate/native-api/desktop-services)
- [自定义 Template](/templates/custom#definition)
- [内置 Template](/templates/builtin)
