---
title: 自定义 Template
description: 编写 Template 定义文件与 Containerfile，在构建机上用 kibo-build 构建，再用 Operator 身份发布与批准；revision 的不可变性、安全更新、版本保留与构建缓存。
---

# 自定义 Template

本页说明怎样构建自己的 Template：编写定义文件与 Containerfile，在独立的构建机上用 `kibo-build` 构建，再用 Operator 身份发布到部署的目录并批准。读者是需要定制 Workspace 环境的接入开发者，以及负责构建与发布的人。已有容器镜像时，也可以直接导入，见[导入现有容器镜像](/templates/oci-import)。

::: warning 目前没有自助 Build 服务
面向终端用户的自助 Build 服务尚未提供。自定义 Template 要由持有 Operator 身份的一方用 `kibo-build` 构建、用 `kibo template publish` 发布。Template 目录由整个部署共享，哪个 revision 可以选用、哪个是默认值通常由平台运营方管理：开始之前，与平台运营方约定由谁构建、谁发布、谁批准。
:::

## 概述 {#overview}

```mermaid
flowchart LR
  D["定义文件与 Containerfile"] --> B["构建机：kibo-build template"]
  B -- "结果目录与 stage 数据" --> O["Operator 工作机：kibo template publish"]
  O --> C["部署的目录：候选 revision"]
  C -- "approve 与 set-default" --> W["可以用它创建 Workspace"]
```

1. 写一份 Template 定义文件 `template.json`，声明内容来源、运行声明与根文件系统容量。
2. 在构建机上以 root 运行 `kibo-build template`，得到结果目录。构建机不需要任何 Operator 凭证。
3. 把结果目录连同它引用的 stage 数据交给持有 Operator 身份的工作机，用 `kibo template publish` 发布成一个候选 revision。
4. 批准这个 revision，按需设为默认，之后就可以用 `kibo workspace create --template` 创建 Workspace。

Platform（内核、guest 程序与 VMM 运行时）不属于 Template，由平台运营方发布与选择。Template 只有在部署里有满足它要求的 Platform 时才能运行，见 [Template 与 Platform](/templates/overview)。

## Template 定义文件 {#definition}

一份定义文件就是一个 Template 的完整配方，命令行不再重复其中的内容。下面的例子沿用内置 Template 的写法：

```json
{
  "schema": "kibotos.template-definition/v1",
  "template_id": "acme-agent",
  "display_name": "Acme Agent Workspace",
  "description": "Acme agent environment with Python and Git",
  "platform": "linux/amd64",
  "architecture": "x86_64",
  "source": {
    "kind": "containerfile",
    "context": ".",
    "containerfile": "Containerfile"
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
    "size_mib": 4096
  },
  "process_defaults": {
    "path": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "shell": "/bin/bash",
    "user": "user"
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `schema` | 是 | 固定为 `kibotos.template-definition/v1` |
| `template_id` | 是 | Template ID，创建 Workspace 时 `--template` 写它。不能为空，不能有首尾空白，不能含 `/`、`\`、换行与 NUL |
| `display_name`、`description` | 是 | 名称与说明，`kibo template get` 显示它们。不能为空，不能有首尾空白，不能含 NUL |
| `platform`、`architecture` | 是 | 固定为 `linux/amd64` 与 `x86_64` |
| `source` | 是 | 内容来源，见下表 |
| `platform_requirements.guest_protocol` | 是 | guest 协议版本，与 Platform 一致才能组合。v0.3.0 的内置 Template 都写 `1` |
| `platform_requirements.rootfs_contract` | 是 | 根文件系统契约版本，不能为 0。v0.3.0 的内置 Template 都写 `2` |
| `guest.capabilities` | 是 | 要求 guest 提供的能力，必须包含 `application-config.v1`，见 [guest 能力](/templates/overview) |
| `guest.ready_semantics` | 是 | guest 的就绪语义，v0.3.0 为 `vsock-http-ready/v1` |
| `required_capabilities` | 是 | 对 node 的能力要求，键值对，没有要求时写 `{}`。键与值都是不含换行、没有首尾空白的文本。创建 Workspace 时与 `--capability` 合并，同一个 key 的值冲突时创建失败。内置 Template 都为 `{}` |
| `rootfs.size_mib` | 是 | 根文件系统 ext4 的容量，单位 MiB，至少 256。内容放不下时构建失败 |
| `process_defaults` | 否 | 默认执行账号、shell 与 PATH，见下文 |

`source` 二选一：

| `kind` | 其他字段 | 说明 |
|---|---|---|
| `containerfile` | `context`、`containerfile` | 构建上下文目录与 Containerfile，相对于定义文件所在的目录，都不能越出这个目录。构建时用受控的 BuildKit 生成内容，需要 Docker |
| `registry` | `reference` | 镜像仓库中的镜像，写成 `仓库@sha256:摘要`，只接受精确摘要，不接受 tag，见[导入现有容器镜像](/templates/oci-import) |

`process_defaults` 的三个字段：

| 字段 | 说明 |
|---|---|
| `user` | 默认执行账号：受管进程、文件操作与桌面会话都以它运行。不能是 `root`；账号名不能为空、不能含 `:`、`/`、换行与 NUL、不能以 `-` 开头。镜像里必须有这个账号，uid 与 gid 都不为 0，并且有 home。不写时一切以 root 运行 |
| `shell` | 非空的绝对路径，请求的命令为空时执行它；不写时为 `/bin/sh` |
| `path` | 完整的 `PATH`；不写时为 `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`，写空字符串表示空的 `PATH` |

- 账号、shell 与 PATH 的值是否存在、是否可执行，在 Workspace 里启动进程时才检查。它们都不从镜像的 `ENV`、`USER` 或 shell 初始化文件推导。
- 只改进程默认配置或 guest 能力要求时，构建只重新组装，复用已有的根文件系统与缓存，得到新的 revision。名称、说明与 `required_capabilities` 是目录里的元数据，不参与 revision 的计算。
- Template ID 在整个部署里共享，选一个不会与已有 Template 冲突的 ID。同一个 Template ID 的名称与说明在第一次发布时确定：之后用这个 ID 发布的 revision 必须使用完全相同的名称与说明，否则发布以冲突失败（退出码 `13`）；同一个 revision 再次发布时，`required_capabilities` 也必须相同。

## Containerfile 编写要点 {#containerfile}

下面的例子按内置 Template 的做法写：声明一个固定 uid、gid 的账号，准备 `/data`，并在构建的最后一步做离线验证。

```dockerfile
# syntax=docker/dockerfile:1
FROM debian:trixie-slim

RUN set -eux; \
    apt-get update; \
    apt-get install --yes --no-install-recommends bash ca-certificates curl git jq python3 sudo; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    groupadd --gid 1000 user; \
    useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash user; \
    chmod 0755 /home/user; \
    mkdir -p /data /usr/local/share/kibotos; \
    chown 1000:1000 /data; \
    chmod 0755 /data; \
    dpkg-query --show --showformat='${Package}\t${Version}\t${Architecture}\n' \
      | LC_ALL=C sort > /usr/local/share/kibotos/dpkg-packages.tsv

RUN --network=none \
    --mount=type=bind,source=verify.sh,target=/opt/acme-template/verify.sh,readonly \
    /bin/bash /opt/acme-template/verify.sh | tee /usr/local/share/kibotos/content-smoke.txt
```

同目录的 `verify.sh` 核对镜像满足下面的要求，任何一条不满足就让构建失败：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

[[ ! -e /sbin/init && ! -e /usr/lib/systemd/systemd ]] || { echo 'the image must not carry an init system' >&2; exit 1; }
[[ $(getent passwd user | cut -d: -f3,4,6) == 1000:1000:/home/user ]] || { echo 'account user must be 1000:1000 with home /home/user' >&2; exit 1; }
[[ $(stat -c '%u:%g:%a' /data) == 1000:1000:755 ]] || { echo '/data must belong to user with mode 0755' >&2; exit 1; }
for command_name in bash curl git jq python3; do
  command -v "$command_name" >/dev/null || { echo "missing command: $command_name" >&2; exit 1; }
done
printf 'python3\t%s\n' "$(python3 --version)"
printf 'git\t%s\n' "$(git --version)"
```

要点：

- **声明账号，固定 uid 与 gid。** 定义里的 `process_defaults.user` 必须在镜像里存在。固定 uid、gid（例如 1000），这样重新构建根文件系统时不会给 Workspace 已经写下的文件换编号。home 保持可遍历（例如 `0755`），root 也要能进入。
- **准备 `/data` 的属主。** 每次启动时，guest 把 Volume 挂载路径的顶层目录交给声明的账号；镜像里的 `/data` 也归这个账号、权限 `0755`，这样不带 Volume 的 Workspace 里它同样可写。
- **镜像不含 init。** 不要安装 systemd 或其他 init 系统，镜像里不应有 `/sbin/init`。guest 程序由 Platform 交付并负责启动，Workspace 启动时不运行镜像里的任何服务；Containerfile 的 `CMD`、`ENTRYPOINT`、`USER`、`WORKDIR` 与 `ENV` 只作为来源信息记录，不生效。需要常驻的进程，在每次启动后由调用方经进程接口启动。
- **`ENV` 不进入受管进程。** 受管进程只得到 `PATH`、`HOME` 与请求给出的变量。工具链的目录写进 `process_defaults.path`；交互式 shell 需要的设置放在 `/etc/profile.d/`，并在 `/etc/bash.bashrc` 里 source 它；需要 `sudo` 时把 `secure_path` 设成同样的 PATH。
- **内核相关的目录保持为空。** 内核来自 Platform，镜像里的 `/usr/lib/modules` 与 `/usr/lib/firmware` 必须为空，否则构建失败。构建会自动建出 `/dev`、`/proc`、`/run`、`/sys`、`/tmp`、`/usr/lib/firmware`、`/usr/lib/modules`，并把 `/tmp` 设为 `1777`。
- **时间戳会被归一化。** 构建把根文件系统里每个文件的时间戳设为 epoch 之后 1 秒。依赖目录修改时间的缓存要按这个时间重建，例如内置桌面 Template 先把字体目录的时间设为 `@1` 再运行 `fc-cache`。
- **构建末尾做离线验证。** 像上面的例子一样，用 `RUN --network=none` 和只读挂载的脚本核对账号、`/data`、不含 init 与关键命令，把版本写进 `/usr/local/share/kibotos/`，并清掉验证留下的临时文件与缓存。
- **控制构建上下文。** 构建上下文按 `.dockerignore` 过滤后的全部文件参与缓存键。内置 Template 的 `.dockerignore` 先排除一切（`*`），再逐个放行需要的文件。
- **能固定的输入就固定。** 底座镜像可以按摘要引用（例如 `FROM alpine:3.24.2@sha256:…`）。`apt-get install` 与「最新版本」的下载每次构建可能取到不同的内容，得到不同的 revision；需要可重复时固定版本，并把实际版本记录在镜像里。
- **保留许可材料。** 保留各软件包的版权与许可文件（Debian 包在 `/usr/share/doc/<package>/copyright`，上游发行物带自己的 `LICENSE`），记录包清单。下载校验只保证完整性，不等于完成了再分发的许可审查。
- 带桌面的 Template 还有更多要求，见[桌面 Template 规范](/templates/desktop)。

## 用 kibo-build 构建 {#build}

### 构建机 {#build-host}

- 一台用 apt 管理软件包的 Linux amd64 机器（Debian 或 Ubuntu）。从平台运营方取得发布包里的独立构建工具包 `kibo-build_0.3.0_amd64.deb` 并安装，apt 会一起装上 Skopeo、umoci、ext4 工具及其运行库：

  ```bash
  sudo apt install ./kibo-build_0.3.0_amd64.deb
  ```

- 工具包含 `kibo-build` 与预编译的 `normalize-ext4`。构建 Template 不需要源码、Git、Go 或 C 编译器。运行时检查工具的最低版本，接受更新的版本，并把实际版本记入结果。
- 用 Containerfile 生成内容时还需要 Docker Engine、Docker CLI 与 Buildx 插件。Buildx 要装在系统范围内：`kibo-build` 使用隔离的 HOME，只装在个人 HOME 里的插件找不到。只从镜像仓库导入时不需要 Docker。
- 以 root 运行。`kibo-build` 不会自动提权，也不会自动下载或安装缺失的工具。
- **构建机不需要任何 Operator 凭证。** 构建终端里不要载入 Operator、ctrl、对象存储或云厂商的凭证：环境变量里出现 `KIBOTOS_CTRL_*`、`KIBOTOS_OPERATOR_*`、`KIBOTOS_ARTIFACT_STORE_*`、`KIBOTOS_S3_*` 或 AWS、Google Cloud、Azure、MinIO 的凭证变量时，`kibo-build` 拒绝运行。发布在另一个账号或另一台机器上完成。
- 构建目录默认是 `/var/lib/kibotos/build`。要换位置，写一个只含 `root = "/srv/kibotos-build"` 的 TOML 文件，放在 `/etc/kibotos/build/config.toml`，或用环境变量 `KIBOTOS_BUILD_CONFIG`、参数 `--config` 指定它。

### 构建 {#build-run}

以 root 运行：

```bash
template_result=$(kibo-build template /srv/templates/acme-agent/template.json)
jq '{kind, publication, provenance}' "$template_result/result.json"
kibo-build cache root
```

- `kibo-build template` 依次完成三个阶段：生成内容（Containerfile 来源经 BuildKit 构建，镜像仓库来源直接下载）、把 OCI 镜像展开成 ext4、压缩并组装。它在标准输出打印结果目录，形如 `<构建目录>/results/kibo-build-result-sha256-<64 位十六进制>`；进度写到标准错误，每个阶段标出 `HIT`（复用缓存）或 `MISS`（重新生成）。
- 展开时保留数字形式的属主、权限、xattr、file capability 与链接，不执行镜像里的任何程序；之后做元数据归一化与 `e2fsck` 检查。
- `--refresh-content` 重新解析底座镜像与软件包，并禁用 BuildKit 的层缓存。普通构建复用层缓存。
- `--cache-root` 与 `--result-parent` 覆盖构建目录下的缓存与结果位置。
- 新构建或刷新失败不会覆盖旧的结果；刷新成功也不会让旧的未发布结果失效。
- `kibo-build cache root` 打印 stage 缓存的根目录，发布时要用到它。

### 交付物 {#handoff}

| 交付物 | 说明 |
|---|---|
| 结果目录 | `kibo-build template` 打印的目录。里面只有元数据，大文件留在 stage 缓存里 |
| 它引用的 stage 数据 | stage 缓存根目录 `<构建目录>/cache/stages` 下的内容 |

- 跨机器交付时保持原有的目录布局，最简单的是把整个构建目录复制过去，并给发布账号只读权限。自定义输出路径时，上级目录也要允许发布账号进入。
- 发布的机器不需要构建机的配置文件，也不需要源码、Go 工具链或 `kibo-build`。

## 发布与批准 {#publish}

发布与批准都需要 Operator 身份（见[安装与连接](/integrate/kibo/setup)）。下面的例子把构建目录原样复制到了 Operator 工作机的 `/srv/build-handoff`；`result_name` 是构建机上 `kibo-build template` 打印的目录名，形如 `kibo-build-result-sha256-` 加 64 位十六进制：

```bash
handoff=/srv/build-handoff
kibo --json template publish "$handoff/results/$result_name" \
  --build-cache-root "$handoff/cache/stages" > publication.json
template_id=$(jq -er '.result.template.template_id' publication.json)
revision=$(jq -er '.result.template.revision' publication.json)
kibo template approve "$template_id" --revision "$revision"
kibo template set-default "$template_id" --revision "$revision"
kibo template list
```

保存 `publication.json`，以后恢复旧的默认版本时需要它记录的 revision。

### 发布 {#template-publish}

- `kibo template publish` 只接受 Template 的构建结果。它完整校验发布内容与 stage 数据，用 ctrl 签发的短期凭证把压缩后的根文件系统直接上传到部署的对象存储，然后在目录中登记一个候选 revision。校验不通过时退出码 `21`。
- `--build-cache-root` 要传 stage 缓存根目录本身，即构建目录下的 `cache/stages`，它直接包含缓存标记文件和内部的又一层 `stages/` 目录。传了上一级的 `cache` 时，命令在连接网络之前就失败，并提示应传的精确路径。不传时，`kibo` 按 `KIBOTOS_BUILD_CONFIG` 或 `/etc/kibotos/build/config.toml` 找到构建目录，适合在同一台机器上发布。
- 默认的幂等键由内容派生，重跑同一次发布不会重复登记。等待后台完成的时限是 `--wait-timeout`，默认 `2h`，超时不会中止发布。
- 输出给出 `Template`（`id@revision`）、发布时间、上传的对象数与命中的对象数、目录状态；JSON 的 `.result.template.template_id` 与 `.result.template.revision` 是之后批准要用的值。
- 发布不做任何批准。刚发布、尚未批准的 revision 不出现在默认的 `kibo template list` 中，用 `kibo template list --selection any` 查看。

### 批准与默认版本 {#template-admission}

| 命令 | 作用 | `--reason` | 能否恢复 |
|---|---|---|---|
| `kibo template approve "$template_id" --revision "$revision"` | 让这个 revision 可以被选用 | 不接受 | 可以用 `disable` 再取消 |
| `kibo template disable "$template_id" --revision "$revision" --reason admin-disabled` | 让这个 revision 不能被选用 | 必填，只接受 `admin-disabled` 或 `admission-rejected` | 可以用 `approve` 恢复 |
| `kibo template withdraw "$template_id" --revision "$revision" --reason "replaced by the next build"` | 永久撤回这个 revision | 必填，写明理由 | 不能恢复 |
| `kibo template set-default "$template_id" --revision "$revision"` | 把这个 Template 的默认 revision 指向它 | 不接受 | 再次执行即可改变 |

- 四个命令都必须用 `--revision` 指定一个精确的 revision，没有「当前版本」这样的隐含目标。它们只修改 Template 目录，不接受 Platform 的 revision，也不改动任何 Platform 的默认版本。
- `disable` 与 `withdraw` 不影响已经用这个 revision 创建的 Workspace，它们继续运行，不会被迁移。
- `set-default` 使用乐观锁：不传期望值时先读取当前的默认 revision；这个 Template 还没有默认版本时用 `--expect-no-default` 说明。提交时默认版本已被别人改动则返回冲突（退出码 `13`），不重试。显式传 `--command-id` 时要同时传 `--expected-revision` 或 `--expect-no-default`。
- 批准已撤回的 revision，或把默认版本指向不可选用的 revision，都以退出码 `13` 失败，并说明是哪个前提不满足。
- 把默认版本移回旧的 revision，不会让新的 revision 变成不可选用；要禁止显式选用它，用 `disable` 或 `withdraw`。
- 在指定 node 上预先下载、校验某个 revision（`kibo template prepare`）是平台运营方的操作，不属于批准。没有预热时，第一次在某台 node 上用这个 revision 创建 Workspace 会在 `CREATING` 停留更久。

## revision、安全更新与版本保留 {#revisions}

- **revision 不可变。** revision 是 Template 清单的 SHA-256 摘要，清单包含 Template ID、根文件系统及其 OCI 来源的摘要，以及进程默认配置、guest 协议、guest 能力要求、就绪语义与根文件系统契约。已发布的 revision 不会改变；产物的字节变化就得到新的 revision。
- **新的默认版本不影响已有的 Workspace。** 已有 Workspace 的 Template revision 在它的生命周期里不变，要用上新版本就用新 revision 创建新的 Workspace，再经 Volume 换绑或 Transfer 带上数据。
- **安全更新靠发布新 revision。** 根文件系统不可变，运行中的修改只在 Workspace 自己的可写层里，已有环境不会自动获得安全更新。更新配方前先查看 Debian、各独立工具链的安全公告；发布前完成离线验证、真实 Workspace 中的启动与生命周期验证。
- **恢复旧的默认版本。** 用之前保存的发布结果里的 revision 再执行一次 `kibo template set-default`。
- **版本保留。** 被 Workspace 精确引用的目录条目与数据都会保留。node 上的缓存可以被驱逐，需要时重新下载同一个 revision；清理缓存不会改变 Workspace 的绑定，也不会用新的字节替换旧的 revision。

## 构建缓存 {#build-cache}

`kibo-build` 按输入的实际内容复用已经验证过的阶段结果：

| 阶段 | 缓存键包含 |
|---|---|
| 生成内容（Containerfile） | 构建上下文里按 `.dockerignore` 过滤后的全部文件：相对路径、类型、权限与内容摘要，不含绝对路径与修改时间 |
| 准备 OCI | OCI 内容与选择参数、实际的 Skopeo 身份、执行者 |
| 转成 ext4 | 选定的 OCI manifest、容量、实际的工具身份、内嵌的 mke2fs 配置、执行者 |
| 压缩 | 未压缩 ext4 的摘要与大小、固定的编码配置、执行者 |

- 运行中的 `kibo-build` 可执行文件的摘要也参与缓存键；升级工具后实际身份变化，会得到新的缓存键。
- Template 的名称、说明与进程默认配置不参与 ext4 阶段的缓存键，只改它们时只重新组装。使用同一个镜像的两个 Template 只压缩一次。
- 缓存命中时重新校验输入记录、生成记录、结果摘要与完整的产物清单。当前格式的损坏结果被移入隔离区并重建；未知格式需要显式清理。缓存命中不证明构建可以逐字节重现。
- BuildKit 进度里的 `CACHED` 表示镜像层命中，`kibo-build` 输出的 `HIT`、`MISS` 表示阶段结果命中或重建，两者分开看。BuildKit 的垃圾回收至少保留 20 GB 可复用缓存，最多使用存储的 80%，并尝试留出 20 GB 空闲空间。
- `kibo-build cache clean` 清理阶段结果、锁、临时目录与隔离区，保留缓存根目录、标记文件、工具状态、下载缓存、BuildKit 的层缓存与结果目录。引用了被清理阶段的本地结果随之失效，需要重新构建；已发布的 Template 不受影响。
- 当前的缓存格式是 stage generation 3，结果格式是 `kibotos.app/build-result/v1alpha6`。更新 `kibo-build` 后，清理旧的缓存，丢弃未发布的旧结果，重新构建。
- 构建被取消时，`kibo-build` 先终止本次的工作进程，再回收挂载与临时目录。无法确认清理是否完成时，命令明确报错并保留 `.rootfs-worker.json`；用 `kibo-build rootfs-recover` 加错误给出的暂存目录恢复，它不触碰其他构建的资源。

## 下一步 {#next-steps}

- [导入现有容器镜像](/templates/oci-import)
- [桌面 Template 规范](/templates/desktop)
- [Template 与 Platform](/templates/overview)
- [内置 Template](/templates/builtin)
