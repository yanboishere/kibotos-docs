---
title: 典型场景
description: Kibotos 适合的几类 AI Agent 运行场景，以及每类场景用到的能力与推荐配置。
---

# 典型场景

本页按场景说明 Kibotos 的用法：每个场景需要什么、用到哪些能力、推荐怎样配置。适合评估 Kibotos 是否满足需求的技术负责人与架构师。

## 编码 Agent 的开发环境 {#coding-agent}

Agent 需要克隆仓库、安装依赖、编译、跑测试，并在多轮对话之间保留工作成果。

| 需求 | Kibotos 的做法 |
|---|---|
| 完整的工具链 | 使用 `kibotos-coding` 这类开发环境 Template，或按需构建自己的 Template，见[内置 Template](/templates/builtin) |
| 执行命令、长时间运行的进程 | 进程 API 或 E2B 的 `commands.run`；网络抖动时进程流自动续传，输出不丢 |
| 工作成果跨会话保留 | 代码与依赖写在 Volume 挂载目录（默认 `/data`），停止后再启动仍在 |
| 控制成本 | 设置到期时间，空闲后自动停止；需要时再启动 |
| 只允许访问代码仓库与包镜像 | `PUBLIC_INTERNET` 加 `allow`、`deny` 收窄到指定网段 |

推荐配置：

- 在 Volume 里工作，例如执行命令时把工作目录设为 `/data`。home 目录与根文件系统的其他位置不承诺跨停止保留。
- 到期动作选 `stop`，Volume 与可写层保留，下次 `start` 继续。
- 按需要调整 CPU、内存与可写层容量；修改在下次启动时生效。

相关文档：[Workspace](/integrate/native-api/workspaces)、[数据面：文件与进程](/integrate/native-api/data-plane)、[网络策略与 DNS](/integrate/native-api/network-policy)。

## 浏览器与 Computer Use Agent {#computer-use}

Agent 需要操作真实的浏览器与桌面应用：截图、点击、输入、读取页面。

| 需求 | Kibotos 的做法 |
|---|---|
| 桌面环境 | `kibotos-desktop` 或 `kibotos-memoh` Template 提供无头 X11 桌面与 Chromium，桌面在第一次使用时才启动 |
| 截图与键鼠 | `DesktopService` 的 `Screenshot` 与 `PerformActions`：移动、点击、拖拽、滚动、按键、输入 UTF-8 文本、粘贴 |
| 人工查看或接管 | 经服务连接访问桌面的 VNC socket；`kibo workspace desktop view` 在本机浏览器里打开桌面 |
| 用 CDP 驱动浏览器 | 经服务连接或 E2B 应用端口访问 guest 内的 Chrome DevTools 端口 |
| 登录状态保留 | 浏览器 profile 放在 Volume 里，例如 `kibotos-memoh` 的 `/data/.memoh/browser` |

相关文档：[桌面与服务连接](/integrate/native-api/desktop-services)、[桌面 Template 规范](/templates/desktop)、[应用端口与桌面](/integrate/e2b/ports)。

## Agent 平台的 bot 工作区 {#agent-platform}

多租户的 Agent 平台为每个 bot 或每个会话维护一个运行环境，数量多、生命周期长、大部分时间空闲。Memoh 就是这样使用 Kibotos 的，见 [Kibotos 与 Memoh](/guide/memoh)。

| 需求 | Kibotos 的做法 |
|---|---|
| 按 bot 管理运行环境 | 每个 bot 一个 sandbox 或 Workspace；用 metadata 或 labels 记录 bot ID，按 label 筛选 |
| 空闲时释放资源 | E2B 的 `autoPause`（`lifecycle.onTimeout: 'pause'`）到期时暂停而不是删除；原生 API 的到期动作 `stop` |
| 恢复后继续工作 | 恢复时重新挂载原有 Volume；内存与进程不保留，需要的状态写进 Volume |
| 容量紧张时不丢数据 | 启动因容量不足失败时，sandbox 仍是暂停状态，容量恢复后再 `connect` 即可 |
| 多套环境互不可见 | 同一部署上的多套 E2B 网关用不同的部署命名空间，互相看不到对方的 sandbox |

相关文档：[暂停与恢复](/integrate/e2b/pause-resume)、[sandbox 生命周期](/integrate/e2b/sandboxes)、[集成最佳实践](/integrate/best-practices)。

## 代码执行与数据分析沙箱 {#code-execution}

LLM 生成的代码需要在一次性的环境里运行，执行完立即丢弃。

| 需求 | Kibotos 的做法 |
|---|---|
| 不可信代码与宿主隔离 | 代码在 MicroVM 里运行，与宿主和其他 Workspace 隔离 |
| 不需要联网 | 原生 API 默认 `DENY_ALL`；E2B SDK 创建时加 `allowInternetAccess: false` |
| 用完即删 | 设置较短的到期时间，到期动作选删除；随 Workspace 新建的 Volume 一并删除 |
| 上传输入、取回结果 | 文件 API 上传数据集，执行后下载结果文件；HTTP 上传下载可以核对 SHA-256 |

相关文档：[通过 E2B SDK 接入](/quickstart/e2b-sdk)、[sandbox 生命周期](/integrate/e2b/sandboxes)。

## 预览 Agent 产出的 Web 应用 {#preview}

Agent 在 Workspace 里写出一个 Web 服务，需要让人直接打开看效果。

| 需求 | Kibotos 的做法 |
|---|---|
| 自己在本机打开 | `kibo workspace service http` 把 guest 内的 HTTP 端口代理到本机 `127.0.0.1` |
| 发给别人看 | Exposure 把端口发布为一条随机的 `https://` 地址，带有效期，Workspace 停止时撤销 |
| 在自己的程序里访问 | 服务连接把字节流接到 guest 内的 TCP 端口或 Unix socket |
| E2B 应用的端口 | `{port}-{sandboxID}.<domain>` 的 HTTP 与 WebSocket 转发 |

::: warning 公开地址没有访问控制
Exposure 地址是随机的，这是它唯一的保护：拿到地址的人就能访问。不要用它发布不该公开的内容。
:::

相关文档：[公开 URL](/integrate/native-api/exposure)、[端口、公开 URL 与桌面](/integrate/kibo/services)。

## 受控出网 {#controlled-egress}

Agent 需要访问你内网里的服务，或者所有出站流量必须经过你的代理审计。

| 需求 | Kibotos 的做法 |
|---|---|
| 访问内网服务 | Workspace 的网络策略引用一个 Egress（你运营的 SOCKS5 端点），发往指定网段的 TCP 经它离开 |
| 出站流量统一经过代理 | Egress 的目的网段写 `0.0.0.0/0` 与 `::/0`；代理不可用时连接失败，不会改为直连 |
| 使用自己的 DNS | 网络策略引用一个 Resolver（UDP、TCP、DoT 或 DoH），可以经 Egress 访问内网解析器 |
| E2B 应用 | 创建或更新网络时设置 `egressProxy` |

相关文档：[Egress 与 Resolver](/integrate/native-api/egress-resolver)、[出网策略与出站代理](/integrate/e2b/network)。

## 下一步 {#next}

- [系统架构](/guide/architecture)
- [核心概念](/guide/concepts)
- [选择接入方式](/quickstart/)
