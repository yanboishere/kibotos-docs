---
title: 通过 kibo 命令行
description: 安装 kibo、用注册密钥注册 Operator 身份，然后创建 Workspace、执行命令、传文件、打开终端，最后停止并删除它。
---

# 通过 kibo 命令行

本页带你从拿到 `kibo` 开始，完成注册，创建一个 Workspace，在里面执行命令、上传下载文件、打开终端，最后停止并删除它。读者是第一次使用 `kibo` 的接入开发者。

`kibo` 是 Kibotos 的命令行工具。它以 Operator 身份经 ctrl 的 mTLS API 操作 Workspace、Volume、网络、端口转发、公开 URL 与桌面，适合人工试用、写脚本和排查问题。

## 前提条件 {#prerequisites}

向平台运营方要三样东西：

| 需要 | 说明 |
|---|---|
| `kibo` 可执行文件 | 发布包里与你的工作机对应的那个文件，以及同一发布包的 `SHA256SUMS` |
| ctrl 地址 | 以 `https://` 开头，例如 `https://ctrl.example.com:18092` |
| 注册密钥 | 一个一次性的密钥文件，要在签发时设定的有效期内使用（默认 1 小时，最长 24 小时） |

发布包里有三个 `kibo` 构建，v0.3.0 的文件名如下：

| 工作机 | 文件 |
|---|---|
| Linux，x86-64 | `kibo_0.3.0_linux_amd64` |
| macOS，Apple Silicon | `kibo_0.3.0_darwin_arm64` |
| macOS，Intel | `kibo_0.3.0_darwin_amd64` |

三个构建出自同一次发布构建，功能相同。macOS 的两个构建只核对了构建身份，没有在 macOS 上做过运行验收。

工作机还要能访问两类地址：ctrl 地址，以及运行 Workspace 的 node 的数据面地址。执行命令、传文件、打开终端这些操作直接连到 node，地址由 ctrl 告诉 `kibo`。需要经代理访问时见[安装与连接](/integrate/kibo/setup)。

::: warning 身份的权限
注册得到的 Operator 身份对整个部署拥有完整的管理权限，目前没有更细的角色：它能看到并操作这个部署里所有调用方的 Workspace。请把它当作管理员凭证保管，见[身份、凭证与访问控制](/security/credentials)。
:::

## 步骤 {#steps}

### 1. 安装 kibo {#install}

先用 `SHA256SUMS` 核对文件，再装到 `PATH` 上，最后在本机查看版本。下面以 Linux 为例，macOS 换成对应的文件名和校验命令：

::: code-group
```bash [Linux]
sha256sum --check --ignore-missing SHA256SUMS
sudo install -m 0755 kibo_0.3.0_linux_amd64 /usr/local/bin/kibo
kibo version --client
```
```bash [macOS]
shasum -a 256 --check --ignore-missing SHA256SUMS
sudo install -m 0755 kibo_0.3.0_darwin_arm64 /usr/local/bin/kibo
kibo version --client
```
:::

`kibo version --client` 不联系 ctrl，只显示本机 `kibo` 的版本、源码 revision 与平台。`Signature` 一行是 `UNSIGNED`：发布物没有发布者签名，`SHA256SUMS` 只用于核对传输是否完整。

### 2. 注册 {#enroll}

把注册密钥保存为 `operator-enrollment.key`，然后执行：

```bash
umask 077
kibo context enroll --endpoint https://ctrl.example.com:18092 --key-file ./operator-enrollment.key
rm ./operator-enrollment.key
kibo context show
kibo version
```

- `umask 077` 让当前 shell 之后新建的文件只有你自己能读写。注册密钥文件对 group 或 other 可读时，`kibo` 会打印警告。
- `context enroll` 用密钥里携带的 ctrl 服务端 CA 验证 ctrl，在本机生成私钥，换取正式的 Operator 身份，连同 ctrl 地址保存到 context 目录（默认 `~/.config/kibo/context`）。之后的命令都自动使用它，不需要再给地址或任何 token。
- 注册成功后密钥已经作废，删除密钥文件。
- `kibo context show` 只读本机的 context，显示身份、ctrl 地址、证书有效期与目录位置。
- `kibo version` 联系 ctrl，显示本机 `kibo` 的版本、ctrl 的源码 revision 与它宣告的能力数量。能显示出来就说明地址与身份都正确。

身份有效 30 天，`kibo` 在剩余不到 10 天时自动续期。提供密钥的其他方式、代理与排查见[安装与连接](/integrate/kibo/setup)。

### 3. 查看可用的 Template {#templates}

```bash
kibo template list
```

表格的 `TEMPLATE` 列是 Template ID，`DEFAULT REVISION` 是不指定版本时使用的 revision。部署里有哪些 Template 由平台运营方发布，内置的 Template 见[内置 Template](/templates/builtin)。下面的例子用 `kibotos-coding`，请换成列表里实际存在的 ID。

### 4. 创建 Workspace {#create}

```bash
template_id=kibotos-coding
workspace_id=$(kibo workspace create --template "$template_id" --memory 1G -q)
kibo workspace get "$workspace_id"
```

- `workspace create` 默认等到 Workspace 变为 `AVAILABLE` 才返回，最多等 1 小时。在终端里运行时，标准错误上有一行随状态刷新的进度。
- `-q` 只输出 Workspace ID，便于赋给变量。之后的命令都需要这个 ID。
- 不加其他参数时：1 个 CPU；新建一个 Volume 挂在 `/data`，删除 Workspace 时一起删除；网络策略是 `deny-all`，Workspace 不能访问外部网络。需要访问公网时加 `--network public-internet`。
- 只有 `/data` 这个 Volume 挂载路径承诺在停止、启动之间保留数据。

全部参数见[管理 Workspace](/integrate/kibo/workspaces#create)。

### 5. 执行命令 {#exec}

```bash
kibo workspace exec "$workspace_id" -- uname -a
kibo workspace exec "$workspace_id" -w /data -- sh -c 'echo hello > hello.txt && ls -l'
```

- `--` 之后是要在 Workspace 里运行的命令。命令不经过 shell 解释，需要管道、重定向等 shell 语法时写 `sh -c '...'`。
- 不带 `-w` 时命令在执行账号的 home 目录启动；`-w /data` 让它在 Volume 里运行。
- `kibo` 的退出码就是远端命令的退出码，与 `ssh` 一致。

### 6. 上传与下载文件 {#files}

```bash
printf 'hello from my laptop\n' > local.txt
kibo workspace file put "$workspace_id" local.txt /data/local.txt
kibo workspace file get "$workspace_id" /data/local.txt downloaded.txt
cmp local.txt downloaded.txt
```

`file put` 边传边计算 SHA-256，并与 Workspace 一侧返回的大小和摘要核对。`file get` 先写到目标旁边的临时文件，收完整后才替换目标。

### 7. 打开终端 {#terminal}

```bash
kibo workspace terminal "$workspace_id"
```

终端需要本地的标准输入与输出都是终端。在远端 shell 中输入 `exit` 退出，`kibo` 以远端 shell 的退出码结束。

### 8. 停止、启动与删除 {#stop-delete}

```bash
kibo workspace stop "$workspace_id"
kibo workspace start "$workspace_id"
kibo workspace exec "$workspace_id" -- cat /data/local.txt
kibo workspace delete "$workspace_id" --yes
```

- `stop` 等 guest 同步文件系统后再停止实例，Volume 与根文件系统的可写层保留，内存和进程不保留。
- `start` 创建新的实例并重新挂载 Volume，所以 `/data/local.txt` 还在。
- `delete` 会说明绑定的 Volume 是一起删除还是保留，再请求确认；不在终端里运行时必须加 `--yes`。这个例子的 Volume 是随 Workspace 新建的，会一起删除。

停止、启动与删除的完整行为见[管理 Workspace](/integrate/kibo/workspaces)，状态的含义见 [Workspace 生命周期](/guide/workspace-lifecycle)。

## 排查 {#troubleshooting}

| 现象 | 处理 |
|---|---|
| `context enroll` 报 `this context does not trust the certificate the ctrl endpoint presents`，退出码 `2` | `--endpoint` 与注册密钥不属于同一个 ctrl，向平台运营方核对地址 |
| 命令报 `server does not advertise capability ...`，退出码 `14` | 这个部署没有提供该功能，`kibo version --wide` 列出部署宣告的全部能力名 |
| `kibo workspace get` 正常，但 `exec`、`file`、`terminal` 连接失败 | 工作机访问不到 node 的数据面地址，向平台运营方确认网络与代理 |
| `workspace create` 等待超时，退出码 `18` | 创建仍在 ctrl 上进行，按错误信息给出的命令查询结果，不要换一个幂等键重新创建 |

更多情形见[安装与连接](/integrate/kibo/setup)与 [kibo 命令参考](/reference/kibo-cli#exit-codes)。

## 下一步 {#next-steps}

- [安装与连接](/integrate/kibo/setup)：context、续期、为程序和同事签发身份、代理。
- [管理 Workspace](/integrate/kibo/workspaces)：创建参数、等待语义、到期、调整资源与 Volume 绑定。
- [kibo 命令参考](/reference/kibo-cli)：全局参数、JSON 输出、退出码与命令索引。
- [Template 与 Platform](/templates/overview)：Workspace 的根文件系统从哪里来。
- [Workspace 生命周期](/guide/workspace-lifecycle)：状态与故障恢复。
