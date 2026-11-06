---
title: 内置 Template
description: Kibotos 维护的四个 Template：kibotos-minimal、kibotos-coding、kibotos-desktop 与 kibotos-memoh 的用途、底座、内容、根文件系统大小、默认账号与 PATH、桌面与工具链。
---

# 内置 Template

本页介绍 Kibotos 维护的四个 Template：它们的用途、底座、装了什么、根文件系统多大、默认以什么账号运行，以及桌面与工具链。读者是为 Workspace 选择 Template 的接入开发者。Template 的一般概念见 [Template 与 Platform](/templates/overview)。

::: tip 以部署里的为准
这四个 Template 的配方随 Kibotos 源码维护，由平台运营方构建并发布到部署里。你所接入的部署实际提供哪些 Template、各自是哪个 revision，以 `kibo template list` 的结果为准。
:::

## 一览 {#summary}

| Template ID | 用途 | 底座 | 根文件系统 | 默认账号 | 桌面 |
|---|---|---|---|---|---|
| `kibotos-minimal` | 最小的验证用 Template | Alpine 3.24 | 512 MiB | 不声明，以 root 运行 | 无 |
| `kibotos-coding` | AI Agent 编码工作的参考开发环境 | Debian 13（trixie） | 4096 MiB | `user` | 无 |
| `kibotos-desktop` | 浏览器类工作的无头 X11 桌面参考环境 | Debian 13（trixie） | 3072 MiB | `user` | 有，1280×800 |
| `kibotos-memoh` | Memoh 的 bot 工作区 | Debian 13（trixie） | 4096 MiB | `user` | 有，1280×960 |

四个 Template 共同的地方：

- 平台都是 `linux/amd64`，要求 guest 提供 `filesystem.v1`、`process.v1` 与 `application-config.v1`；两个桌面 Template 另外要求 `service.unix-stream.v1` 与 `desktop.v1`。见 [guest 能力](/templates/overview)。
- 都不对 node 提出额外的能力要求。
- 镜像里没有 init 系统，Workspace 启动时不会自动运行镜像里的任何服务。
- 声明了 `user` 的三个 Template 里，`user` 的 uid 与 gid 都是 1000，home 是 `/home/user`，登录 shell 是 `/bin/bash`，有免密 `sudo`；`/data` 在镜像里归它所有，权限 `0755`。
- 镜像里的 `/usr/local/share/kibotos/` 记录了包清单与构建时验证得到的软件版本（`dpkg-packages.tsv`、`content-smoke.txt`；`kibotos-minimal` 除外）。

## kibotos-minimal {#minimal}

| 项 | 内容 |
|---|---|
| 底座 | Alpine 3.24.2 |
| 软件 | `bash`、`ca-certificates`、`curl`、`iproute2`、`musl-utils`、`python3` |
| 默认账号 | 不声明，进程以 root 运行，home 为 `/root` |
| shell | 不声明，为 `/bin/sh` |
| PATH | 不声明，为 `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` |

它只带验证套件与测量工具要用的命令，适合连通性检查与快速试用。需要开发工具时用 `kibotos-coding`。

## kibotos-coding {#coding}

| 项 | 内容 |
|---|---|
| 底座 | Docker 官方镜像 `golang:1.27-trixie`（Debian 13） |
| 默认账号 | `user`，`sudo` 的 `secure_path` 就是下面的 PATH，提权不会丢掉工具链 |
| shell | `/bin/bash` |
| PATH | `/home/user/.local/bin:/home/user/go/bin:/home/user/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin:/home/user/.cargo/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` |

| 工具链 | 内容 |
|---|---|
| Go | 来自底座镜像，在 `/usr/local/go` |
| Node.js | v24.22.1，官方发行包解包到 `/usr/local`，npm 的全局 prefix 也是 `/usr/local`；另有 Corepack 与 pnpm（构建时的最新版本，pnpm 已预先下载，离线也能运行） |
| Python | uv 安装的托管 Python（构建时的默认版本），`python`、`python3` 指向它 |
| uv、uvx | 官方安装器安装的构建时最新版本 |
| Rust | rustup 的 stable 工具链，含 rustfmt、clippy、rust-analyzer |
| 系统软件 | Debian 的开发与诊断包，例如 build-essential、gcc、g++、clang、cmake、ninja-build、gdb、lldb、git、jq、ripgrep、fd、sqlite3、strace、tcpdump、socat、openssh-client、rsync |

- 各工具链的入口同时链接到 `/usr/local/bin`，所以 PATH 被重置的场合（`sudo`、没有环境的进程）也能调用它们。
- 运行时自己装的命令落在 Template 的 PATH 上：以 `user` 运行时，`npm install --global` 进 `/usr/local/bin`，`cargo install`、`uv tool install`、`go install` 分别进 `~/.cargo/bin`、`~/.local/bin`、`~/go/bin`。这些位置在可写层上，不是承诺保留的路径。
- 交互式 Bash 会加载 uv、uvx 的补全；经 `kibo workspace exec` 启动的非交互进程不运行 shell 初始化，直接使用 Template 声明的 PATH。
- 镜像不带 Node 版本管理器。需要别的 Node 版本时，由发布方出一个新的 Template revision。
- 构建的最后一步在不联网的条件下，分别以 root 和 `user` 编译并测试 C、C++、Go、Node.js、Python、Rust 的示例项目，并记录实际版本。

## kibotos-desktop {#desktop}

| 项 | 内容 |
|---|---|
| 底座 | Docker 官方镜像 `debian:trixie-slim`（Debian 13） |
| 默认账号 | `user`，桌面会话也以它运行 |
| shell | `/bin/bash` |
| PATH | `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` |
| 桌面 | Xvfb、x11vnc 与 XFCE 会话组件（xfce4-session、xfwm4、xfdesktop4、xfce4-panel、xfce4-terminal、thunar）。会话程序 `/usr/bin/startxfce4`，屏幕 1280×800，色深 24，会话环境带 `LANG=C.UTF-8` |
| 启动时机 | 带按需启动标记：开机时不运行桌面，第一次有人使用时才启动 |
| 浏览器 | Debian 归档的 Chromium，带 setuid 沙箱 helper；默认浏览器、终端与文件管理器分别是 Chromium、Debian 的默认终端与 Thunar |
| 字体 | DejaVu、Noto CJK（中文）、Noto Color Emoji |

- 浏览器保留自身的沙箱：guest 内核不提供非特权用户命名空间时，由 setuid helper 提供沙箱，不关闭沙箱运行。
- 经 `kibo workspace exec` 启动、需要显示的程序（例如 `xdotool`）要先请求桌面，再设置 `DISPLAY` 与 `XAUTHORITY`，见[桌面 Template 规范](/templates/desktop)。
- 构建的最后一步会真正启动一次无头桌面：启动 Xvfb 与声明的会话，核对屏幕尺寸，启动 x11vnc 并从 Unix socket 读到 `RFB 003.008`，同时确认 VNC 没有监听 TCP 端口。
- 用 `kibo workspace desktop view` 在浏览器中查看桌面，见[端口、公开 URL 与桌面](/integrate/kibo/services)。

## kibotos-memoh {#memoh}

Memoh 是一个 AI Agent 平台，`kibotos-memoh` 是它的 bot 工作区。它在桌面之外还交付一套固定版本的工具链、一组由 Memoh Server 按绝对路径调用的脚本与一个无障碍助手。Memoh 怎样使用它见 [Kibotos 与 Memoh](/guide/memoh)。

| 项 | 内容 |
|---|---|
| 底座 | Docker 官方镜像 `debian:trixie-slim`（Debian 13） |
| 默认账号 | `user` |
| shell | `/bin/bash` |
| PATH | `/data/.memoh/deps/bin:/opt/memoh/toolkit/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` |
| 桌面 | 与 `kibotos-desktop` 同构，屏幕 1280×960，带按需启动标记。会话启动时自动运行 `display-prepare.sh` 与 dock（plank） |
| 浏览器 | Debian 归档的 Chromium，保留自身的沙箱 |
| 字体 | DejaVu、Noto CJK、Noto Color Emoji、Inter |
| 无障碍 | at-spi2-core 与无障碍助手 `a11y-cli` |

`kibotos-memoh` 的路径约定假定 Volume 挂在 `/data`。用 `--mount-path` 换了挂载路径或用 `--no-volume` 创建时，`/data/.memoh/` 下的内容落在可写层上，不再承诺保留。

### 工具链 {#memoh-toolkit}

工具链固定在 `/opt/memoh/toolkit`，来自上游发行物而不是 Debian 归档，因为调用方按这些版本线安装自己的 CLI：

| 工具 | 版本 |
|---|---|
| Node.js | 24.22.1 |
| npm | 10.9.9 |
| CPython | 3.14.8（python-build-standalone，tag `20261003`） |
| uv | 构建时的最新版本 |

`/opt/memoh/toolkit/bin` 下的九个启动器 `node`、`npm`、`npx`、`python`、`python3`、`pip`、`pip3`、`uv`、`uvx` 是工具链唯一的入口，PATH 把它们排在系统目录之前。

### 工作区安装的依赖 {#memoh-deps}

Agent CLI（例如 `codex`、`claude`）**不在镜像里**：它们由工作区自己安装到 `/data/.memoh/deps`。镜像里有同名命令会顶替工作区装的那份，所以构建时的验证会确认它们不存在。`/data/.memoh/deps/bin` 排在 PATH 的最前面，它在 Volume 上，停止与启动之后仍在。

### 脚本 {#memoh-scripts}

`/opt/memoh/scripts/` 下的脚本由调用方按绝对路径执行：

| 脚本 | 作用 |
|---|---|
| `memoh-display-env.sh` | 被其他入口 source，提供 `DISPLAY` 与 `XAUTHORITY`。guest 的 X socket 还不存在时，先向 guest 请求桌面，等 X 与 VNC 就绪再返回 |
| `display-prepare.sh` | 等待显示与桌面会话就绪，启动浏览器并等它的调试端点应答；输出带 `__MEMOH_DISPLAY_PROGRESS__` 前缀的进度行 |
| `display-browser.sh` | 打开浏览器的唯一入口：显示准备、dock、应用菜单与默认浏览器都经它启动，共用一个 profile 与调试端点。`--background` 在后台启动，`--running` 检查浏览器是否在运行 |
| `display-apply-style.sh` | 为调用方保留的入口。桌面样式已随镜像就绪，它总是回答样式已就绪 |

guest 把桌面放在显示 `:0`；`display-prepare.sh` 另外把 `:99` 做成 `:0` 的别名，供仍按 `:99` 寻址的调用方使用。

### 浏览器 {#memoh-browser}

| 项 | 内容 |
|---|---|
| profile | `/data/.memoh/browser`，在 Volume 上：Cookie、站点存储与登录状态在停止、启动与换 Template revision 之后保留 |
| HTTP 缓存 | `~/.cache/chromium`，不进 Volume |
| 调试端点 | guest 内的 `127.0.0.1:9222`。从工作机访问时用 `kibo workspace service forward "$workspace_id" --tcp-port 9222` |
| 启动参数 | `/etc/chromium.d/memoh`，所有启动方式共用 |
| 托管策略 | `/etc/chromium/policies/managed/memoh.json`：关闭组件更新、本地基础模型下载、后台模式与指标上报 |

::: warning 浏览器 profile 是敏感数据
profile 里有登录状态，能读到这个 Volume 的一方就能取得它。经 Transfer 导出 Volume 时，`/data/.memoh/browser` 会一起导出，见 [Volume 与数据迁移](/integrate/kibo/storage)。
:::

浏览器大约每 30 秒把 Cookie 写入磁盘一次，停止 Workspace 不等浏览器正常退出，最近一小段时间里的变化可能丢失。

### 无障碍助手 {#memoh-a11y}

`/opt/memoh/toolkit/display/bin/a11y-cli` 是无障碍助手的入口，供 Memoh 的 Computer Use 工具读取界面的无障碍树。它先 source `memoh-display-env.sh` 取得显示环境，再运行编译好的 `/opt/memoh/toolkit/display/libexec/a11y-cli`。助手的源码随 Template 配方维护（Apache-2.0），在镜像构建时编译，编译工具链随后删除。Chromium 以 `--force-renderer-accessibility` 启动，页面内容也进入无障碍树。

### 桌面样式与许可材料 {#memoh-style}

- 桌面样式（xfconf、GTK 与 dock 的默认配置）随镜像交付，会话启动时即已是成品。
- 桌面主题、图标、光标与壁纸在构建时从上游项目的默认分支取得并运行它们自带的安装脚本，**不锁定版本**，两次构建可能得到不同的主题修订。壁纸的来源与许可各不相同，再分发前需要逐项复核。
- 工具链（Node.js、npm、CPython、uv）直接取自上游发行物，复核许可时除了 `/usr/share/doc/<package>/copyright` 还要看这些发行物自带的许可文件。

## 版本与更新 {#updates}

- 每个 Template 的内容随 revision 固定。标明「构建时的最新版本」的软件在两次构建之间可能不同，实际版本看 Workspace 里的 `/usr/local/share/kibotos/`。
- 已有的 Workspace 不会自动获得安全更新。平台运营方发布新的 revision 后，用它创建新的 Workspace，见 [Template 与 Platform](/templates/overview)。
- 需要这些 Template 之外的软件时，可以在运行中的 Workspace 里安装（落在可写层上，尽力保留），或者构建自己的 Template，见[自定义 Template](/templates/custom)。

## 下一步 {#next-steps}

- [Template 与 Platform](/templates/overview)
- [自定义 Template](/templates/custom)
- [桌面 Template 规范](/templates/desktop)
- [Kibotos 与 Memoh](/guide/memoh)
