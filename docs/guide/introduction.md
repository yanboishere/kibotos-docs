---
title: Kibotos 是什么
description: Kibotos 是面向 AI Agent 的 Workspace 执行栈：在独立的 MicroVM 中提供文件、进程会话、持久卷、网络策略与桌面。
---

# Kibotos 是什么

本页介绍 Kibotos 提供什么、由哪几部分组成，以及你可以通过哪几种方式接入。适合第一次了解 Kibotos 的开发者与技术负责人。

## 概述 {#overview}

Kibotos 是面向 AI Agent 的 Workspace 执行栈。Agent 需要一台可以随意执行命令、读写文件、安装依赖、打开浏览器的机器，同时这台机器又不能影响宿主和其他租户。Kibotos 为每个这样的运行环境创建一个 **Workspace**：

- 运行在独立的 **MicroVM** 中，有自己的内核、根文件系统与 CPU、内存上限。
- 根文件系统来自一个 **Template**，例如带 Node.js、Python、Go、Rust 的开发环境，或带无头桌面与 Chromium 的浏览器环境。
- 默认挂一个 **Volume**（`/data`），这个目录在 Workspace 停止、再启动之后仍然保留。
- 由 **网络策略** 决定它能访问哪些外部地址，默认拒绝全部出站。
- 通过 **数据面** 提供文件读写、进程与终端、目录监视、桌面截图与键鼠输入、到 guest 内端口的连接。

所有 Workspace 由控制面 ctrl 统一管理：创建、调度到合适的 node、启动、停止、到期回收、删除。

## 核心能力 {#capabilities}

| 能力 | 说明 | 详见 |
|---|---|---|
| 隔离的执行环境 | 每个 Workspace 一台 MicroVM，后端为 Firecracker 或 KiboVM | [隔离与网络安全](/security/isolation) |
| 进程与终端 | 启动进程或 PTY，流式收发输入输出；连接中断后续传，输出不丢、输入不重 | [数据面：文件与进程](/integrate/native-api/data-plane) |
| 文件 | 目录与元数据操作，HTTP 上传下载（支持 Range），目录变化监视 | [数据面：文件与进程](/integrate/native-api/data-plane) |
| 持久数据 | Volume 独立于 Workspace 存在，可以扩容、换绑、导出与恢复 | [Volume 与 Transfer](/integrate/native-api/volumes-transfers) |
| 生命周期 | 停止与启动、到期后自动停止或删除、强制停止与失败恢复 | [Workspace 生命周期](/guide/workspace-lifecycle) |
| 网络策略 | 拒绝全部或开放公网；按地址与网段收窄；经调用方的 SOCKS5 出口离开；自选 DNS 上游 | [网络策略与 DNS](/integrate/native-api/network-policy) |
| 桌面 | 按需启动的无头 X11 桌面，截图、键鼠输入、VNC | [桌面与服务连接](/integrate/native-api/desktop-services) |
| 端口访问 | 把 guest 内的端口转发给调用方程序，或发布为公开的 HTTPS 预览地址 | [公开 URL](/integrate/native-api/exposure) |
| 运行状况观测 | guest 是否还在回应、是否顶在内存上限、停止原因、资源释放情况 | [运行状况观测](/integrate/native-api/observability) |
| E2B 兼容 | 官方 E2B SDK 可以直接使用 Kibotos | [E2B 兼容 API](/integrate/e2b/overview) |

## 组成 {#components}

从接入方的角度，Kibotos 由下面几部分组成。平台运营方负责部署与运维它们，你只需要知道请求会经过哪里。

| 组件 | 作用 |
|---|---|
| ctrl | 控制面。保存 Workspace、Volume 等对象的权威状态，接受写命令并执行到底，把 Workspace 调度到 node，签发访问数据面的短期凭证 |
| node | 运行 MicroVM 的宿主。每个 node 有一个数据面入口，文件、进程、桌面流量直接到这里，不经过 ctrl |
| guest | MicroVM 里的 agent，执行进程、读写文件、驱动桌面 |
| E2B 网关 | 把 E2B 的控制 API 与 envd 协议翻译成 Kibotos 原生 API。无状态，可以多实例 |
| Exposure 网关 | 把 Workspace 内的 HTTP 端口发布成公开的 `https://` 地址。只有平台运营方开启了这项功能时才有 |

各组件之间的关系与请求路径见[系统架构](/guide/architecture)。

## 接入方式 {#access-methods}

| 方式 | 你需要从平台运营方获得 | 适合 |
|---|---|---|
| [E2B 兼容 API](/integrate/e2b/overview) | API key、sandbox 域名、可用的 Template ID | 已有 E2B 代码；按 sandbox 管理运行环境 |
| [原生 API](/integrate/native-api/overview) | ctrl 地址、Operator 注册密钥 | 需要 Kibotos 的完整能力 |
| [`kibo` 命令行](/integrate/kibo/setup) | `kibo` 程序、ctrl 地址、Operator 注册密钥 | 人工操作、脚本与排查 |

怎样选择见[选择接入方式](/quickstart/)。

::: warning Operator 身份的权限
原生 API 与 `kibo` 使用 Operator 身份认证。当前版本没有更细的角色划分：已注册的 Operator 对所在部署拥有完整的管理权限。请按[身份、凭证与访问控制](/security/credentials)保管身份目录。
:::

## 与 Memoh 的关系 {#memoh}

Kibotos 与 Memoh 出自同一团队。Memoh 是 AI Agent 平台，它的 bot 工作区运行在 Kibotos 的 Workspace 中：Memoh Server 通过 E2B 兼容网关创建和管理这些 Workspace，使用的 `kibotos-memoh` Template 带无头桌面、浏览器、无障碍助手与固定版本的 Node.js、Python 工具链。详见 [Kibotos 与 Memoh](/guide/memoh)。

## 当前版本 {#version}

本文档适用于 **v0.3.0**。Kibotos 仍处于 0.x 阶段：从 v0.1.0 起，外部调用的接口有兼容承诺，不兼容的变化会留一个 MINOR 版本的过渡期，见[兼容策略](/releases/compatibility)。暂不提供的能力（例如内存快照、sandbox 克隆）见[版本状态与支持范围](/guide/maturity)。

## 下一步 {#next}

- [典型场景](/guide/use-cases)
- [系统架构](/guide/architecture)
- [核心概念](/guide/concepts)
- [选择接入方式](/quickstart/)
