---
title: 通过 E2B SDK 接入
description: 用官方 E2B JavaScript SDK 连接平台运营方提供的 Kibotos 部署，创建 sandbox、执行命令、读写文件并删除。
---

# 通过 E2B SDK 接入

本页带你用官方 E2B JavaScript SDK 跑通第一个 sandbox：创建、执行命令、读写文件、删除。读者是已经在使用或准备使用 E2B SDK 的开发者，完成后可以把同样的代码接进自己的 Agent 产品。

Kibotos 的 E2B 兼容网关把官方 SDK 的请求翻译成 Kibotos 原生 API，SDK 代码只需要换成平台运营方提供的域名与 API key。网关的工作方式见[概述与兼容范围](/integrate/e2b/overview)。

## 前提条件 {#prerequisites}

向平台运营方获取以下信息：

| 信息 | 示例 | 用途 |
|---|---|---|
| API key | 一个字符串 | 控制 API 的认证，等同于这个部署的全部权限，按密钥保管 |
| sandbox 域名 | `sandbox.example.com` | SDK 的 `domain` 参数 |
| 控制 API 地址 | `https://api.sandbox.example.com` | SDK 的 `apiUrl` 参数，总是 `https://api.<domain>` |
| 可用的 Template ID | `kibotos-minimal` | 创建 sandbox 时使用的环境 |

本机需要：

- Node.js 与 npm。验收环境使用 Node.js 22 及以上版本。
- 能访问 `api.<domain>` 与 `*.<domain>` 的 HTTPS 网络。

::: tip
平台运营方的 HTTPS 证书由私有 CA 签发时，向它索取 CA 证书文件，并用 Node.js 的 `NODE_EXTRA_CA_CERTS` 环境变量指向这个文件的绝对路径。不要用关闭 TLS 校验的方式绕过。
:::

## 安装 SDK {#install}

新建一个项目目录并安装 SDK，把版本固定在已验收的 `2.46.1`：

```bash
mkdir kibotos-quickstart && cd kibotos-quickstart
npm init -y
npm install --save-exact e2b@2.46.1
```

::: warning 注意
Kibotos 的 E2B 兼容目标是 `e2b@2.49.1`，但 `2.49.1` 尚未取得验收结论，当前验收基线是 `2.46.1`。升级 SDK 前先在测试环境验证。其他语言的官方 SDK 未经验收。
:::

## 配置环境变量 {#environment}

把 API key 保存到只有自己能读的文件里，粘贴 key 后回车，再按 Ctrl-D 结束输入：

```bash
mkdir -p "$HOME/.config/kibotos" && chmod 700 "$HOME/.config/kibotos"
(umask 077 && cat > "$HOME/.config/kibotos/e2b-api-key")
```

设置示例程序读取的环境变量，取值换成平台运营方提供的信息：

```bash
export E2B_DOMAIN=sandbox.example.com
export E2B_API_URL=https://api.sandbox.example.com
export E2B_API_KEY_FILE="$HOME/.config/kibotos/e2b-api-key"
export E2B_TEMPLATE=kibotos-minimal
```

示例程序把这些值显式传给 SDK，不依赖 SDK 自己读取的环境变量。

## 创建并使用 sandbox {#first-sandbox}

在项目目录里新建 `quickstart.mjs`。程序创建一个 10 分钟后到期的 sandbox，执行一条命令，写入并读回一个文件，列出目录，最后删除 sandbox：

```javascript
import { readFile } from 'node:fs/promises';
import { Sandbox } from 'e2b';

const domain = process.env.E2B_DOMAIN;
const config = {
  apiKey: (await readFile(process.env.E2B_API_KEY_FILE, 'utf8')).trim(),
  domain,
  apiUrl: process.env.E2B_API_URL || `https://api.${domain}`,
  requestTimeoutMs: 120_000,
};

// 1. 创建 sandbox：10 分钟后到期，到期时删除
const sandbox = await Sandbox.create(process.env.E2B_TEMPLATE || 'kibotos-minimal', {
  ...config,
  secure: true,
  timeoutMs: 10 * 60_000,
  lifecycle: { onTimeout: 'kill', autoResume: false },
  metadata: { purpose: 'quickstart' },
});
console.log('sandbox:', sandbox.sandboxId);

try {
  // 2. 执行命令，等待结束并取得输出
  const result = await sandbox.commands.run('uname -sr && id -un');
  console.log(result.stdout);

  // 3. 写入文件并读回
  await sandbox.files.write('/data/hello.txt', 'hello from kibotos\n');
  console.log(await sandbox.files.read('/data/hello.txt'));

  // 4. 列出目录
  for (const entry of await sandbox.files.list('/data')) {
    console.log(entry.path);
  }
} finally {
  // 5. 删除 sandbox
  await sandbox.kill();
}
```

运行它：

```bash
node quickstart.mjs
```

程序依次输出 sandbox ID、内核版本与执行账号、文件内容，以及 `/data` 下的条目。

各步骤的说明：

- **创建。** `Sandbox.create()` 在 sandbox 就绪、可以执行命令之后才返回，最长等待约 90 秒，所以示例把 `requestTimeoutMs` 设为 120 秒。CPU、内存与磁盘按部署的默认值分配（默认 1 核、1 GiB 内存、5 GiB 根文件系统可写空间，取决于部署配置），见[资源](/integrate/e2b/sandboxes)。
- **metadata。** 给每个 sandbox 打上你自己的标识，之后可以按 metadata 列出和清理，例如创建请求超时、不知道 sandbox ID 的时候。
- **执行命令。** 命令以 Template 声明的默认账号运行，工作目录是这个账号的 home 目录。命令以非零状态退出时，`commands.run()` 抛出 `CommandExitError`，它的 `exitCode` 是退出码。
- **`/data`。** 每个 sandbox 自带一个挂在 `/data` 的 Volume，属于 Template 声明的默认账号。暂停再恢复之后，这里的数据仍在；删除 sandbox 时它随之删除。需要在多个 sandbox 之间保留的数据放进独立 Volume，见 [Volume](/integrate/e2b/volumes)。
- **删除。** `kill()` 删除 sandbox，成功返回 `true`。忘记删除的 sandbox 到期后按到期动作处理。

## 不需要联网的 sandbox {#offline}

SDK 创建 sandbox 时默认请求公网访问（`allowInternetAccess` 默认为 `true`）。只处理本地数据、不需要联网的 sandbox，在创建参数里加上 `allowInternetAccess: false`：

```javascript
const sandbox = await Sandbox.create(process.env.E2B_TEMPLATE || 'kibotos-minimal', {
  ...config,
  timeoutMs: 10 * 60_000,
  lifecycle: { onTimeout: 'kill', autoResume: false },
  allowInternetAccess: false,
});
```

这样创建的 sandbox 的出站连接全部被拒绝，DNS 查询同样失败。部署支持的地址族与出网能力取决于部署配置，可以向平台运营方确认。按地址放行、经自己的代理出网等用法见[出网策略与出站代理](/integrate/e2b/network)。

## 选择到期动作 {#timeout-action}

每个 sandbox 都有到期时间，由 `timeoutMs` 决定。建议在创建时用 `lifecycle` 显式写出到期动作：

| 写法 | 到期时 |
|---|---|
| `lifecycle: { onTimeout: 'kill', autoResume: false }` | 删除 sandbox，包括挂在 `/data` 的 Volume。独立 Volume 保留 |
| `lifecycle: { onTimeout: 'pause', autoResume: false }` | 暂停 sandbox，之后可以用 `Sandbox.connect()` 恢复 |

- 暂停是冷暂停：恢复时重新开机，内存与运行中的进程不保留，只有 Volume 里的数据承诺保留，见[暂停与恢复](/integrate/e2b/pause-resume)。
- `autoResume: true`（收到请求时自动恢复）暂不支持，创建请求会失败并返回 501。
- 运行中可以用 `sandbox.setTimeout(ms)` 重新设置到期时间，见[到期时间](/integrate/e2b/sandboxes)。
- 部署可能限制单次请求的最长有效期，超过时创建返回 400，取决于部署配置。

## 排查 {#troubleshooting}

| 现象 | 原因 | 处理 |
|---|---|---|
| SDK 抛出 `AuthenticationError` | API key 缺失或不被接受，网关返回 401 `invalid API key` | 检查 key 文件内容与 `E2B_API_KEY_FILE` 的路径 |
| TLS 证书校验失败 | 部署使用私有 CA，本机不信任 | 用 `NODE_EXTRA_CA_CERTS` 指向平台运营方提供的 CA 文件 |
| 创建返回 404 | Template ID 不存在 | 向平台运营方确认可用的 Template ID |
| 错误消息以 `501: create sandbox: unimplemented:` 开头 | 创建参数里有网关不支持的选项，例如 `envs` | 去掉这个选项，见[明确未提供的能力](/integrate/e2b/differences#unsupported) |
| 创建返回 503，消息含 `resource_exhausted` | 部署暂时没有容量 | 稍后重试。按 metadata 列出 sandbox，删除可能留下的暂停中的 sandbox |
| 创建返回 400，消息说 timeout 超过上限 | `timeoutMs` 超过部署允许的最长有效期 | 缩短 `timeoutMs`，或向平台运营方确认上限 |
| 命令里访问外网超时或失败 | 创建时关闭了公网访问，或部署限制出网 | 检查 `allowInternetAccess` 与 `network` 参数 |

更多状态码的含义见 [HTTP 状态码](/integrate/e2b/differences#status-codes)。

## 下一步 {#next-steps}

- [概述与兼容范围](/integrate/e2b/overview)：域名、凭证、兼容版本与支持的接口。
- [sandbox 生命周期](/integrate/e2b/sandboxes)：创建选项、查询与列表、到期时间、幂等。
- [命令、终端与文件](/integrate/e2b/commands-files)：后台命令、PTY、目录监视。
- [与 E2B 的差异](/integrate/e2b/differences)：迁移已有 E2B 代码前先读这一页。
- [集成最佳实践](/integrate/best-practices)
