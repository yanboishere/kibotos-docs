---
title: 导入现有容器镜像
description: 用 kibo-build 把镜像仓库中或本地 OCI layout 的现有 Linux/amd64 镜像导入为 Template：前提条件、定义文件、步骤、受管进程的默认配置与排查。
---

# 导入现有容器镜像

本页说明怎样把一个已有的 Linux/amd64 容器镜像导入为 Template：镜像可以在镜像仓库里，也可以是本地的 OCI layout。导入得到的构建结果与用 Containerfile 构建的一样，之后按[自定义 Template](/templates/custom#publish)发布与批准。读者是已经有现成镜像、想直接用它作为 Workspace 环境的人。

::: warning 目前没有自助服务
面向终端用户的自助 Build 服务尚未提供，导入同样由持有 Operator 身份的一方完成。导入也没有自动批准、镜像签名生成或漏洞扫描。
:::

## 概述 {#overview}

- `kibo-build` 用 Skopeo 下载并校验一个按摘要固定的镜像，再用 umoci 在私有的挂载命名空间里把它直接展开到 ext4。展开时保留数字形式的属主、权限、xattr、file capability 与链接，**不执行镜像里的任何程序**；之后做元数据归一化与离线检查。
- 镜像的 `Cmd`、`Entrypoint`、`User`、`WorkingDir` 与 `Env` 只作为来源信息记录。Workspace 以什么账号、什么环境运行，由 Template 定义文件明确指定，不从镜像推导，见[受管进程的默认配置](#process-defaults)。
- 导入只把镜像内容变成根文件系统，Workspace 的网络、宿主机权限与 Secret 都与它无关。导入成功只说明根文件系统通过了构建时的检查：镜像能否在两种后端上启动、Workspace 的行为是否正确，要在选定的 Platform 上验证。
- 内核、initramfs、guest 程序与 VMM 运行时都由 Platform 管理，与镜像无关。Volume 的挂载路径在创建 Workspace 时指定，默认 `/data`。

## 前提条件 {#prerequisites}

**构建机**

- 一台用 apt 管理软件包的 Linux amd64 机器。从平台运营方取得 `kibo-build` 的独立工具包并安装，apt 会一起装上 Skopeo、umoci 与 ext4 工具；工具包自带 `kibo-build` 与编译好的 `normalize-ext4`，不需要源码、Git、Go 或 C 编译器：

  ```bash
  sudo apt install ./kibo-build_0.3.0_amd64.deb
  ```

- 导入以 root 运行。`kibo-build` 不会自动调用 `sudo`，也不会下载或安装工具；它在运行时检查工具的最低版本，接受更新的版本，并把实际版本与摘要记录到结果里。
- 从镜像仓库导入不需要 Docker。
- 构建终端不要载入 Operator、ctrl、对象存储或云厂商的凭证，`kibo-build` 发现这类环境变量时拒绝运行。发布由另一个账号或另一台机器完成。

**镜像**

- 平台是 Linux/amd64，用摘要（`sha256:…`）固定；本地输入是 OCI layout 目录或 OCI layout 格式的 tar 归档。`docker save` 生成的归档不是这种格式。
- 内核模块与固件目录（`/usr/lib/modules`、`/usr/lib/firmware`）为空。内核来自 Platform，这两个目录非空时导入失败。
- 有你要在定义里声明的东西：要声明的非 root 账号（uid 与 gid 不为 0，有 home）、作为默认 shell 的程序，以及容纳全部内容的容量。
- 不依赖镜像里的 init 系统或开机自启的服务：Workspace 启动时只运行 Platform 交付的 guest 程序。当前版本不检测镜像里的 `/sbin/init`，导入成功不代表这一点已被验证。

## 准备定义文件 {#definition-file}

镜像来源与根文件系统的容量都写在 Template 定义文件里，命令行不再重复。下面的定义导入一个公开的 Python 镜像；`reference` 里的摘要是 Kibotos 在 2026-08-14 的导入验收中使用的 `python:3.13-slim` 镜像索引，使用时换成你自己的镜像：

```json
{
  "schema": "kibotos.template-definition/v1",
  "template_id": "acme-python",
  "display_name": "Acme Python",
  "description": "Imported python:3.13-slim image",
  "platform": "linux/amd64",
  "architecture": "x86_64",
  "source": {
    "kind": "registry",
    "reference": "docker.io/library/python@sha256:ffb752e139c0a19692a43af8d8523b274222dd68eebad5d583b45c2201c6e30a"
  },
  "platform_requirements": {
    "guest_protocol": 1,
    "rootfs_contract": 2
  },
  "guest": {
    "capabilities": ["filesystem.v1", "process.v1", "application-config.v1"],
    "ready_semantics": "vsock-http-ready/v1"
  },
  "required_capabilities": {},
  "rootfs": {
    "size_mib": 2048
  },
  "process_defaults": {}
}
```

- 每个字段的含义见 [Template 定义文件](/templates/custom#definition)。
- `reference` 只接受精确摘要，写成 `仓库@sha256:摘要`；tag 被拒绝，`仓库:tag@sha256:摘要` 这样同时带 tag 的写法也被拒绝。`@` 之前出现任何 `:` 都按 tag 处理，所以仓库地址里也不能写端口号。镜像索引会按 `linux/amd64` 选出对应的镜像。
- 这个例子的 `process_defaults` 为空：进程以 root 运行，shell 为 `/bin/sh`，PATH 为默认值。导入自己的镜像前，重点核对账号、shell、PATH 与容量是否与镜像内容匹配。

## 步骤 {#steps}

### 从镜像仓库导入 {#import-registry}

以 root 运行一条命令，完成下载、生成 ext4 与组装：

```bash
template_result=$(kibo-build template /srv/templates/acme-python/template.json)
jq '{kind, publication, provenance}' "$template_result/result.json"
```

访问镜像仓库的参数：

| 参数 | 说明 |
|---|---|
| `--registry-auth-file` | 私有仓库的认证文件（`auth.json` 格式）。不给时匿名访问 |
| `--registry-cert-dir` | 私有 CA 或客户端证书所在的目录：CA 为 `*.crt`，客户端证书与私钥为 `*.cert` 与 `*.key`。TLS 始终校验，默认使用系统 CA |
| `--signature-policy` | 镜像签名策略文件。给出时每次都从原始来源校验签名，缓存命中也不例外 |
| `--registry-signatures-dir` | 签名策略需要 lookaside 或 sigstore 附件配置时，给出配置所在的目录 |

- 默认接受未签名的镜像，但所有输入都必须通过摘要校验。
- `kibo-build` 不读取 root 账号的默认认证文件、仓库配置或 `REGISTRY_AUTH_FILE` 等环境变量，只有显式给出的参数生效。凭证的路径与内容不会写入任何产物。
- Skopeo 复用标准的 `/var/lib/containers/cache` 元数据缓存；这个缓存不保存认证配置，也不替代摘要与签名校验。

### 从本地 OCI 导入 {#import-local}

定义文件不能直接引用本地目录，所以分两步：先生成 ext4，再用定义文件组装。

```bash
kibo-build rootfs --oci-layout /srv/images/acme-python \
  --size-mib 2048 --output /var/lib/kibotos-build/acme-python.ext4
template_result=$(kibo-build template /srv/templates/acme-python/template.json \
  --rootfs /var/lib/kibotos-build/acme-python.ext4)
```

- 第一步以 root 运行。`--oci-archive /srv/images/acme-python.oci.tar` 代替 `--oci-layout` 从 OCI layout 归档导入；layout 或归档里有多个镜像时用 `--source-tag` 选择。
- `--size-mib` 必须与定义里的 `rootfs.size_mib` 一致，组装时会再次核对。
- 第一步写出 ext4 文件与同目录的 `acme-python.ext4.json`，后者记录来源、选定的镜像、实际使用的工具、最终摘要与字节数。输出文件必须不存在；所有检查与清理都完成后才写出这两个文件。
- 第二步不需要 root，也不重新展开镜像，能读这两个文件的账号就可以执行。它核对 ext4 与 JSON 是否对应，然后组装 Template。组装时不读取定义里的 `source`，但定义文件仍要通过校验。
- 只改名称、能力或进程默认配置时，只需要重新执行第二步。
- `kibo-build rootfs` 输出的是未压缩的 ext4，只用于组装；压缩只在组装时进行，所以它本身不产生可发布的对象。

### 发布 {#publish-imported}

把结果目录连同 stage 数据交给持有 Operator 身份的一方，按[发布与批准](/templates/custom#publish)发布并批准。Template ID 与 revision 以发布结果为准。之后创建一个 Workspace 验证镜像是否按预期工作：

```bash
workspace_id=$(kibo workspace create --template acme-python --memory 1G -q)
kibo workspace exec "$workspace_id" -- sh -c 'id; echo "$PATH"; python3 --version'
```

## 受管进程的默认配置 {#process-defaults}

Template 定义里的 `process_defaults` 决定经 Workspace 进程接口启动的程序默认以什么账号、什么环境运行。导入时它不从镜像推导，需要按镜像内容写出：

```json
"process_defaults": {
  "path": "/opt/tools/bin:/usr/local/bin:/usr/bin:/bin",
  "shell": "/bin/bash",
  "user": "app"
}
```

| 字段 | 说明 |
|---|---|
| `path` | 完整的 PATH。不写时为 `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`；写空字符串表示空的 PATH。进程请求里的 `PATH` 优先于它 |
| `shell` | 非空的绝对路径。请求的命令为空时执行这个程序；不写时为 `/bin/sh`。命令非空时直接执行，不会自动加上 shell；`SHELL` 环境变量不影响程序选择 |
| `user` | 默认执行账号，不能是 `root`；镜像里必须有这个账号，uid 与 gid 不为 0，并且有 home。不写时以 root 运行 |

- 镜像的 `ENV`（包括其中的 `PATH`）、`USER` 与 `WORKDIR` 都不生效。镜像依赖 `ENV PATH` 里的目录时，把它们写进 `path`；镜像以非 root 的 `USER` 运行时，把那个账号写进 `user`。
- 文件是否存在、是否可执行，在 Workspace 里启动进程时才检查。发布与读取时都拒绝包含 NUL 的值。
- 只修改这些声明会得到新的 revision，但复用原有的根文件系统与缓存。
- 每个 Template 都要求 Platform 支持 `application-config.v1`，不支持的 Platform 无法与它组合。

## 排查 {#troubleshooting}

| 现象 | 原因与处理 |
|---|---|
| `registry source requires an exact @sha256: reference` 或 `registry source must not carry a tag alongside its digest` | `reference` 不是精确摘要的写法，改成 `仓库@sha256:摘要` |
| 摘要不符、平台或 media type 不支持 | 镜像不是 Linux/amd64，或来源内容与摘要不一致，核对镜像 |
| `backend-neutral rootfs contains kernel-coupled content: /usr/lib/modules`（或 `/usr/lib/firmware`） | 镜像里带了内核模块或固件，从镜像里去掉它们 |
| 容量不足、ext4 或 `e2fsck` 检查失败 | 调大 `rootfs.size_mib`（本地导入时 `--size-mib` 一起改） |
| `template definition requires a rootfs size of at least 256 MiB` | `rootfs.size_mib` 小于 256 |
| `build process refuses inherited configuration or credential …` | 构建终端里有 ctrl、Operator、对象存储或云厂商的凭证变量，换一个干净的终端 |
| 缺少 Skopeo、umoci 或 ext4 工具 | 用 apt 安装工具包的依赖；`kibo-build` 不会自己安装 |
| Workspace 里以默认账号执行的请求以 `failed_precondition` 失败 | 声明的账号在镜像里不存在、uid 或 gid 为 0，或没有 home。核对镜像的 `/etc/passwd` |

失败时：

- `kibo-build` 先终止本次的工作进程，再回收挂载与临时目录。已经成功的缓存阶段保留，重跑时复用。
- 无法确认清理是否完成时，命令明确报错并保留恢复所需的状态与路径（`.rootfs-worker.json`）。用 `kibo-build rootfs-recover` 加错误给出的暂存目录恢复后再重试，它不会删除其他构建的资源。
- 已有的缓存结果会先重新校验，当前格式的损坏结果被移入隔离区后重建。

## 下一步 {#next-steps}

- [自定义 Template](/templates/custom#publish)
- [Template 与 Platform](/templates/overview)
- [内置 Template](/templates/builtin)
