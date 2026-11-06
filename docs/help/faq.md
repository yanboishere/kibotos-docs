---
title: 常见问题
description: 关于 E2B 兼容、暂停与数据保留、资源、网络、桌面、权限、指标、版本与 Template 的常见问题。
---

# 常见问题

## 产品与接入 {#product}

### Kibotos 与 E2B 是什么关系？ {#e2b-relation}

Kibotos 是独立实现的 Workspace 执行栈，它提供一个 E2B 兼容网关，把 E2B 的控制 API 与 envd 协议翻译成 Kibotos 的原生 API。官方 E2B SDK 把域名与 API key 指向 Kibotos 即可使用 sandbox、命令、文件、Volume、暂停恢复、应用端口与指标。网关没有实现的能力返回 501，见[与 E2B 的差异](/integrate/e2b/differences)。

### 支持哪个版本的 E2B SDK？Python SDK 可以用吗？ {#sdk-version}

兼容目标是官方 JavaScript SDK `e2b@2.49.1`，已验收的基线是 `e2b@2.46.1`，建议固定到已验收的版本。其他语言的官方 SDK 走同一套协议，但没有经过验收。

### E2B 的 sandbox 和 Workspace 是什么关系？ {#sandbox-workspace}

sandbox 就是 Workspace，sandbox ID 就是 Workspace ID。持有 Operator 身份时，可以用 `kibo workspace get` 或原生 API 直接查看经 E2B 创建的 sandbox；sandbox 的 metadata 显示为前缀 `m.e2b.kibotos.app/` 的 labels。

### 应该用 E2B 兼容 API 还是原生 API？ {#which-api}

已有 E2B 代码、只需要 sandbox 的基本操作时用 E2B 兼容 API；需要指定资源、Transfer、Resolver、桌面截图与键鼠、运行状况观测时用原生 API。见[选择接入方式](/quickstart/)。

## 数据与生命周期 {#data}

### 暂停后恢复，内存和进程还在吗？ {#pause-memory}

不在。Kibotos 的暂停是冷暂停：停止执行、释放资源；恢复时重新启动一台 MicroVM。SDK 发送的 `memory: true` 会被接受，但同样按冷暂停处理。Volume 里的数据保留，根文件系统的修改只是尽力保留。见[暂停与恢复](/integrate/e2b/pause-resume)。

### 哪些数据在停止或暂停后一定保留？ {#what-persists}

只有 Volume 挂载目录（默认 `/data`）承诺保留。home 目录等根文件系统的其他位置尽力保留，可能重建；`/tmp`、`/run` 与内存不保留。见[数据持久性与保护](/security/data)。

### 删除 sandbox 会删除数据吗？ {#delete-data}

不带 `volumeMounts` 创建的 sandbox，网关为它新建的 `/data` Volume 随 sandbox 一起删除。按名称挂载的 Volume 在删除 sandbox 后保留，需要用 `DELETE /volumes/{id}` 显式删除。原生 API 按绑定上的「随 Workspace 删除」开关处理。

### Workspace 会自动续期吗？ {#auto-renew}

不会。执行命令、读写文件都不延长到期时间，需要显式延期。到期由 ctrl 执行，你的程序退出不影响它。

## 资源 {#resources}

### 一个 Workspace 能用多少资源？ {#resource-limits}

原生 API 与 `kibo` 创建时指定 CPU、内存与可写层容量，上限由调度时可用的容量决定。E2B 创建请求不带资源字段，网关按部署的默认值申请，默认 1 核、1 GiB 内存、5 GiB 可写空间。见[限制与默认值](/reference/limits)。

### 创建时提示容量不足怎么办？ {#capacity}

容量不足是可重试的错误。稍后重试，或调小资源后重试。E2B 的 sandbox 在恢复失败后仍是暂停状态，容量恢复后再 `connect` 即可。

### 可以在 Workspace 里运行虚拟机吗？ {#nested}

默认不可以。guest 看不到 CPU 的硬件虚拟化扩展，不能在 Workspace 里再运行 KVM。

### 支持 ARM 吗？ {#arm}

当前 guest 只支持 `linux/amd64`（x86_64）。`kibo` 命令行有 Linux x86-64 与 macOS（Apple Silicon、Intel）构建，macOS 构建没有做运行验收。

## 网络 {#network}

### Workspace 默认能访问公网吗？ {#default-network}

原生 API 与 `kibo` 创建的 Workspace 默认 `DENY_ALL`，没有任何出站。E2B SDK 默认开放公网，不需要时创建参数加 `allowInternetAccess: false`。

### 能让 Workspace 访问我们的内网服务吗？ {#intranet}

可以经 Egress：你运营一个 SOCKS5 端点，Workspace 的网络策略把指定网段的 TCP 连接交给它。内网的 DNS 用 Resolver 经同一个 Egress 访问。见 [Egress 与 Resolver](/integrate/native-api/egress-resolver)。

### Workspace 能访问云厂商的元数据服务吗？ {#metadata-service}

不能。链路本地网段 `169.254.0.0/16` 与其他私有、特殊用途地址在任何策略下都被拒绝。见[隔离与网络安全](/security/isolation#hard-deny)。

### 支持按域名放行出网吗？ {#domain-allowlist}

不支持。`allow`、`deny` 只接受地址与 CIDR；E2B 的 `allowOut` 里写域名返回 501。

### 为什么我在 guest 里改的 `/etc/hosts`、`/etc/resolv.conf` 重启后没了？ {#etc-files}

guest 每次启动都重写 `/etc/hostname`、`/etc/hosts` 与 `/etc/resolv.conf`，对它们的修改不跨启动保留。

## 端口与桌面 {#ports-desktop}

### 怎样把 Agent 写的 Web 应用给别人看？ {#share-app}

部署开启了 Exposure 时，用 `kibo exposure create` 或 `ExposureService` 生成一条公开的 `https://` 地址，有效期最长 24 小时。E2B 接入方可以直接使用 `{port}-{sandboxID}.<domain>` 的应用端口。公开地址没有访问控制，只用于可以公开的内容。

### 怎样查看 Agent 的桌面？ {#view-desktop}

使用带桌面的 Template（`kibotos-desktop`、`kibotos-memoh`）。人工查看用 `kibo workspace desktop view`，在本机浏览器里打开桌面；程序可以用 `DesktopService` 截图与发送键鼠输入，或经服务连接访问 VNC socket。见[桌面与服务连接](/integrate/native-api/desktop-services)。

## 权限与安全 {#security}

### 可以只给某个程序只读权限吗？ {#readonly}

当前版本没有更细的角色。已注册的 Operator 对所在部署拥有完整的管理权限。数据面的会话凭证可以按 scope 限定（例如只给 `FILE_READ`），但申请凭证本身需要 Operator 身份。

### E2B 的 API key 可以按团队或项目区分吗？ {#api-key-teams}

不可以。一套 E2B 网关部署的 API key 由整个部署共用，没有团队。需要互相隔离的业务，请平台运营方为它部署独立的命名空间，不同命名空间之间看不到对方的 sandbox 与 Volume。

### 平台会记录命令的输出或文件内容吗？ {#logging}

不会。平台日志不记录进程的参数、环境变量与输入输出、文件内容、路径与文件名、剪贴板与屏幕内容，也不记录任何凭证。见[安全模型](/security/overview#not-logged)。

## 观测与计费 {#observability}

### 怎样知道一个 Workspace 是不是卡住了？ {#stuck}

读 `guest_observation`：它报告 guest 是否还在回应、进程是否顶在内存上限、guest 是否重启过。这些是观测结果，不改变 Workspace 的状态。见[运行状况观测](/integrate/native-api/observability)。

### sandbox 指标可以用来计费吗？ {#metrics-billing}

不建议。sandbox 指标只用于观察，存储不可达、guest 没有按时应答或 node 重启时，对应时段的样本会缺失。

## 版本与 Template {#versions}

### 升级会破坏我的集成吗？ {#upgrade}

承诺范围内的接口不兼容变化至少保留一个 MINOR 版本的过渡期，并写在[变更记录](/releases/changelog)的「升级须知」里。按能力名判断服务端支持的形态，不要按版本号分支。见[兼容策略](/releases/compatibility)。

### 可以使用自己的镜像吗？ {#custom-image}

可以把自己的 Containerfile 构建成 Template，或导入现有的 OCI 镜像。当前没有面向终端用户的自助构建服务，Template 由持有 Operator 身份的一方构建并发布。见[自定义 Template](/templates/custom)。

### Template 更新后，已有的 Workspace 会自动升级吗？ {#template-update}

不会。Workspace 创建时固定了 Template revision，之后默认 revision 的变化不影响它。要使用新版本，创建新的 Workspace，必要时经 Transfer 迁移 Volume 数据。
