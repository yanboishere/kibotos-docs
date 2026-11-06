---
layout: home
title: Kibotos 文档
titleTemplate: 面向 AI Agent 的 MicroVM Workspace

hero:
  name: Kibotos
  text: 为 AI Agent 提供隔离的 MicroVM 工作空间
  tagline: 文件、进程会话、持久卷、网络策略与桌面，在独立的 MicroVM 中运行，由一套 API 统一管理。兼容 E2B SDK，是 Memoh 的 bot 工作区底座。
  image:
    src: /hero.svg
    alt: Kibotos
  actions:
    - theme: brand
      text: 快速开始
      link: /quickstart/
    - theme: alt
      text: 了解 Kibotos
      link: /guide/introduction
    - theme: alt
      text: E2B 兼容 API
      link: /integrate/e2b/overview

features:
  - icon:
      src: /icons/isolation.svg
    title: MicroVM 级隔离
    details: 每个 Workspace 运行在独立的 MicroVM 中，有自己的内核、根文件系统与资源上限。Firecracker 与 KiboVM 都是正式后端。
    link: /security/isolation
    linkText: 隔离模型
  - icon:
      src: /icons/compat.svg
    title: 兼容 E2B SDK
    details: 官方 E2B SDK 指向 Kibotos 的域名即可使用：sandbox、命令与终端、文件、Volume、暂停恢复、应用端口与指标。
    link: /integrate/e2b/overview
    linkText: 兼容范围
  - icon:
      src: /icons/volume.svg
    title: 持久卷与数据迁移
    details: Volume 在停止与启动之间保留数据，可以扩容、换绑，也可以经 Transfer 导出后恢复成新的 Workspace。
    link: /integrate/native-api/volumes-transfers
    linkText: Volume 与 Transfer
  - icon:
      src: /icons/network.svg
    title: 默认拒绝的网络策略
    details: 按地址与网段放行或拒绝出站；需要时让流量经调用方自己的 SOCKS5 出口离开，把 DNS 交给自选的上游。
    link: /integrate/native-api/network-policy
    linkText: 网络策略
  - icon:
      src: /icons/desktop.svg
    title: 桌面与浏览器
    details: 无头 X11 桌面、截图与键鼠 API、VNC 与 Chrome DevTools 端口，满足浏览器自动化与 Computer Use 类 Agent。
    link: /integrate/native-api/desktop-services
    linkText: 桌面与服务连接
  - icon:
      src: /icons/reliable.svg
    title: 可重放的写操作
    details: 每个写操作都带幂等键与版本校验，超时后用同一个键重发即可；能力协商让客户端按服务端实际能力工作。
    link: /integrate/native-api/conventions
    linkText: 调用约定
---

## 按角色开始阅读 {#by-role}

| 我是… | 我想… | 从这里开始 |
|---|---|---|
| 接入开发者 | 用现有的 E2B 代码接入 | [通过 E2B SDK 接入](/quickstart/e2b-sdk) |
| 接入开发者 | 从自己的服务直接管理 Workspace | [通过原生 API](/quickstart/native-api) |
| 接入开发者 | 在命令行里试用、排查 | [通过 kibo 命令行](/quickstart/kibo-cli) |
| 技术负责人、架构师 | 评估能力、架构与限制 | [Kibotos 是什么](/guide/introduction)、[系统架构](/guide/architecture)、[版本状态与支持范围](/guide/maturity) |
| 安全与合规评审 | 了解隔离、身份与数据保护 | [安全模型](/security/overview) |
| Memoh 用户 | 了解 bot 工作区的运行方式 | [Kibotos 与 Memoh](/guide/memoh) |

## 三种接入方式 {#access-methods}

| 方式 | 适合 | 认证 | 入口 |
|---|---|---|---|
| E2B 兼容 API | 已经使用 E2B SDK 的应用，或按 sandbox 管理 Agent 运行环境的平台 | API key 与 sandbox token | [E2B 兼容 API](/integrate/e2b/overview) |
| 原生 API | 需要完整能力（Volume 换绑、Transfer、Egress、Resolver、公开 URL、观测）的服务端程序 | mTLS 客户端证书（Operator 身份）与短期会话凭证 | [原生 API](/integrate/native-api/overview) |
| `kibo` 命令行 | 人工操作、脚本与排查 | 与原生 API 相同 | [kibo 命令行](/integrate/kibo/setup) |

::: info 当前版本
本文档适用于 Kibotos **v0.3.0**。Kibotos 仍处于 0.x 阶段，兼容承诺的范围与过渡规则见[兼容策略](/releases/compatibility)，能力边界见[版本状态与支持范围](/guide/maturity)。
:::
