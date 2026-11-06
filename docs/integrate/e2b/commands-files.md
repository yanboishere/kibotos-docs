---
title: 命令、终端与文件
description: 通过 E2B 的 envd 协议在 sandbox 里执行命令、使用 PTY、读写文件与监视目录：支持的方法、线上协议、消息上限、流的续传与 SDK 示例。
---

# 命令、终端与文件

本页说明怎样通过 E2B 的 envd 协议使用 sandbox 内部：执行命令与后台进程、使用 PTY 终端、读写文件、监视目录。也说明网关支持哪些 envd 方法、线上协议与上限，以及连接中断时的行为。读者是使用 SDK 的 `commands`、`pty`、`files`，或自己实现 envd 客户端的开发者。

envd 协议的地址是 `49983-<sandboxID>.<domain>`，每个请求都要带 `X-Access-Token`，SDK 自动处理。执行账号与工作目录的规则见[执行身份](/integrate/e2b/overview)。本页示例中的 `sandbox` 是 `Sandbox.create()` 或 `Sandbox.connect()` 返回的对象。

## 协议 {#protocol}

### 支持的方法 {#methods}

| 方法 | SDK 用法 | 说明 |
|---|---|---|
| `/process.Process/Start` | `commands.run()`、`pty.create()` | 启动普通命令或 PTY，服务端流 |
| `/process.Process/Connect` | `commands.connect()`、`pty.connect()` | 按 PID 重新连接正在运行的进程，服务端流 |
| `/process.Process/SendInput` | `sendStdin()`、`pty.sendInput()` | 写入 stdin 或 PTY 输入 |
| `/process.Process/CloseStdin` | `closeStdin()` | 关闭 stdin |
| `/process.Process/SendSignal` | `kill()`、`pty.kill()` | 只支持 `SIGTERM` 与 `SIGKILL` |
| `/process.Process/Update` | `pty.resize()` | 调整 PTY 大小 |
| `/filesystem.Filesystem/Stat` | `files.getInfo()` | 读取条目信息 |
| `/filesystem.Filesystem/MakeDir` | `files.makeDir()` | 创建目录 |
| `/filesystem.Filesystem/Move` | `files.rename()` | 移动或改名 |
| `/filesystem.Filesystem/ListDir` | `files.list()` | 列出目录，`depth` 缺省为 1 |
| `/filesystem.Filesystem/Remove` | `files.remove()` | 删除 |
| `/filesystem.Filesystem/WatchDir` | `files.watchDir()` | 监视一层目录，服务端流 |
| `GET /files` | `files.read()` | 下载文件内容 |
| `POST /files` | `files.write()` | 上传文件内容 |
| `GET /health` | `isRunning()` | 健康检查，不需要 token |

Connect 风格的方法都用 POST。未实现的方法见[不支持的方法](#unsupported-methods)。

### 线上格式 {#wire-format}

进程与文件系统方法的线上格式与 E2B 的 envd 相同，按 E2B 发布的 envd proto（`e2b@2.49.1` 对应的版本）提供：

- 支持 Connect、gRPC 与 gRPC-Web 三种协议，JSON 与二进制两种编码，以及 gzip 压缩协商。
- JSON 编码按 protobuf 的 JSON 映射：int64 写成字符串（例如条目的 `size`），枚举写成名字，bytes 用 base64，未知字段被忽略，零值字段不输出。
- JSON 值之后有多余内容、同一字段重复出现、同一 oneof 给了多个成员时返回 `invalid_argument`。流式方法的请求不是恰好一条消息时返回 `unimplemented`。
- 一元方法失败时，HTTP 状态按 Connect 规范对应错误码，例如 `invalid_argument` 与 `failed_precondition` 为 400，`unauthenticated` 为 401，`not_found` 为 404，`resource_exhausted` 为 429，`unimplemented` 为 501，`unavailable` 为 503。流式方法的错误一律放在流的结束消息里，HTTP 状态为 200。

各错误码的处理建议见 [HTTP 状态码](/integrate/e2b/differences#status-codes)。

### 上限 {#limits}

- **请求消息最多 4 MiB。** 进程与文件系统方法的每条请求消息最多 4 MiB，压缩的按解压后计算。超出时返回 `resource_exhausted`，请求不会转发给 sandbox。E2B 不设这个上限。JSON 编码下 bytes 按 base64 膨胀约三分之一，所以单次 `sendStdin()` 或 `pty.sendInput()` 超过约 3 MiB 的数据要分几次发送。
- **输出方向没有这个上限。** 命令与 PTY 的输出超过 4 MiB 也会完整送达。
- **文件内容走 `/files`。** `files.write()` 与 `files.read()` 使用 `GET /files`、`POST /files`，不受 4 MiB 上限约束。单个文件每次读取或写入最多 1 GiB，速率上限 64 MiB/s，见[文件传输](/integrate/native-api/data-plane#files-http)。
- **及时读取流。** 流式响应的每条消息要在 5 秒内写给调用方。调用方停止读取超过 5 秒时，这条流结束；进程本身照常运行，可以重新连接。
- **guest 内的资源。** 进程数、线程数与内存受 guest 内的上限约束，资源不够启动进程时启动返回 `resource_exhausted`，见 [guest 内的资源上限](/integrate/native-api/data-plane#guest-limits)。

## 进程 {#processes}

### 运行命令 {#run}

`commands.run()` 启动命令并等它结束，返回 `stdout`、`stderr` 与 `exitCode`。命令以非零状态退出时抛出 `CommandExitError`：

```javascript
import { CommandExitError } from 'e2b';

const result = await sandbox.commands.run('ls -la', { cwd: '/data', timeoutMs: 30_000 });
console.log(result.exitCode, result.stdout);

try {
  await sandbox.commands.run('exit 3');
} catch (error) {
  if (error instanceof CommandExitError) console.log('exit code', error.exitCode); // 3
  else throw error;
}

// 单条命令的环境变量与流式输出
await sandbox.commands.run('echo "$GREETING from $(hostname)"', {
  envs: { GREETING: 'hello' },
  onStdout: chunk => process.stdout.write(chunk),
  onStderr: chunk => process.stderr.write(chunk),
});
```

- 官方 SDK 用 `/bin/bash -l -c` 执行命令，Template 里要有 `/bin/bash`。login shell 会读取镜像里的 shell 配置，可能改写 `PATH` 等环境变量。
- 不指定 `cwd` 时，命令在执行账号的 home 目录启动，不是 `/`。
- 单条命令的 `envs` 可以使用。创建 sandbox 时的 `envs`（为整个 sandbox 设置环境变量）暂不支持，创建返回 501。

### 后台命令与重新连接 {#background}

`background: true` 让 `commands.run()` 在进程启动后立即返回句柄。句柄提供 `pid`、`sendStdin()`、`closeStdin()`、`wait()`、`kill()` 与 `disconnect()`：

```javascript
// 带 stdin 的后台命令
const counter = await sandbox.commands.run('wc -c', { background: true, stdin: true, timeoutMs: 60_000 });
await counter.sendStdin('hello\n');
await counter.closeStdin();
console.log((await counter.wait()).stdout.trim()); // 6

// 长期运行的服务：断开输出流后进程继续运行
const server = await sandbox.commands.run('python3 -m http.server 8080 --bind 0.0.0.0', {
  background: true,
  timeoutMs: 0,
});
await server.disconnect();

// 之后按 PID 重新连接，或结束它
const attached = await sandbox.commands.connect(server.pid, { timeoutMs: 60_000 });
await attached.kill();
```

- 进程不随输出流结束。调用方断开或网络中断后，进程照常运行，可以用 `commands.connect(pid)` 重新连接。重新连接从当前位置开始接收输出，断开期间的输出不会补发。
- 长期运行的服务用 `timeoutMs: 0`。
- 网关只按 PID 选择进程。envd 协议里按 `tag` 选择进程的写法返回 `invalid_argument`，列出进程（`commands.list()` 使用的 `Process/List`）返回 `unimplemented`。需要找回进程时自己保存 PID。

### PTY {#pty}

```javascript
let output = '';
const terminal = await sandbox.pty.create({
  rows: 24,
  cols: 80,
  timeoutMs: 10 * 60_000,
  onData: data => { output += Buffer.from(data).toString(); },
});
await sandbox.pty.resize(terminal.pid, { rows: 40, cols: 120 });
await sandbox.pty.sendInput(terminal.pid, Buffer.from('stty size\n'));

// 断开后重新连接同一个终端
await terminal.disconnect();
await sandbox.pty.connect(terminal.pid, {
  onData: data => process.stdout.write(Buffer.from(data)),
  timeoutMs: 10 * 60_000,
});

// 结束终端，成功返回 true
await sandbox.pty.kill(terminal.pid);
```

### 信号与退出码 {#signals}

- `SendSignal` 只支持 `SIGTERM` 与 `SIGKILL`，其他信号返回 `invalid_argument`。
- SDK 2.46.1 的 `kill()`、`commands.kill()` 与 `pty.kill()` 固定发送 `SIGKILL`，没有选择 `SIGTERM` 的参数。需要让进程优雅退出时，在命令里自己发送信号，例如 `kill -TERM 1234`。
- 被信号结束的进程，退出码是 128 加信号值，例如被 `SIGKILL` 结束时为 137。

### 流的自动续传 {#stream-resume}

网关与 sandbox 所在 node 之间的进程流断开时，网关自动续上，SDK 收到的仍是同一条流，输出不丢失也不重复，最多重试 30 秒。

- sandbox 为每个进程的每个输出通道保留最近 1 MiB 的输出。断开太久、期间的输出超过这 1 MiB 时，丢失的部分补不回来，这条流以 `data_loss` 结束，消息说明丢失的字节数。网关不会把有缺口的输出当作连续的输出交给 SDK。
- `data_loss` 只表示输出有缺口，进程本身不受影响。进程仍在运行时，可以用 `commands.connect(pid)` 重新连接，从当前位置继续接收。
- sandbox 重新启动（例如暂停再恢复）后，原来的进程已经不在，续传结束，调用方需要重新 `connect` sandbox。

续传在原生层面的机制见[进程流续传](/integrate/native-api/data-plane#process-resume)。

## 文件 {#files}

### 读写文件 {#read-write}

```javascript
await sandbox.files.makeDir('/data/reports');
await sandbox.files.write('/data/reports/q3.csv', 'region,revenue\nnorth,42\n');

const text = await sandbox.files.read('/data/reports/q3.csv');
const bytes = await sandbox.files.read('/data/reports/q3.csv', { format: 'bytes' });
console.log(text, bytes.length);
```

`files.read()` 对应 `GET /files?path=...`：

- 支持单段 `Range` 请求与 `If-Range`。响应透传 `Content-Type`、`Content-Length`、`Content-Range`、`Accept-Ranges`、`ETag` 与 `Last-Modified`。
- `path` 缺失或为空返回 400。执行账号用 basic auth 或 `username` 查询参数指定。

`files.write()` 对应 `POST /files`：

- 请求体是文件的原始内容（目标路径在 `path` 查询参数里），或 `multipart/form-data`（每个部分的 `filename` 是目标路径，一次可以上传多个文件）。
- `Content-Encoding` 只接受 `identity` 或 `gzip`，gzip 的内容在写入前解压并校验。
- 成功返回 200，响应体是写入的条目列表，每项是 `{"path": ..., "name": ..., "type": "file"}`。
- multipart 上传中途失败时，前面的文件可能已经写入。

常见的失败：

| 情况 | 结果 |
|---|---|
| 目标目录只读（以 root 写入也一样） | 403，不可重试 |
| 文件系统空间或配额用尽 | 413，不可重试，原有文件保持不变 |
| 路径不存在 | 404 |
| Template 声明的默认账号在 guest 中不可用 | 409，见[执行身份](/integrate/e2b/overview) |
| `X-Access-Token` 缺失或不正确 | 401 |

### 目录与元数据 {#filesystem-ops}

```javascript
const info = await sandbox.files.getInfo('/data/reports/q3.csv');
console.log(info.size);

await sandbox.files.rename('/data/reports/q3.csv', '/data/reports/2026-q3.csv');
for (const entry of await sandbox.files.list('/data', { depth: 2 })) {
  console.log(entry.path);
}
console.log(await sandbox.files.exists('/data/reports/q3.csv')); // false
await sandbox.files.remove('/data/reports/2026-q3.csv');
```

- `files.list()` 的 `depth` 缺省为 1，只列出一层。
- 条目信息的 `owner` 与 `group` 是数字形式的 uid 与 gid（字符串），不是账号名。
- 写入只读目录返回 `permission_denied`，空间或配额用尽返回 `resource_exhausted`，两者都不可重试。

### 监视目录 {#watch-dir}

`files.watchDir()` 报告一个目录里条目的变化，不必轮询：

```javascript
import { FilesystemEventType } from 'e2b';

await sandbox.files.makeDir('/data/inbox');
const watcher = await sandbox.files.watchDir('/data/inbox', event => {
  if (event.type === FilesystemEventType.CREATE) {
    console.log('new entry:', event.name, event.entry?.path);
  }
}, { includeEntry: true, timeoutMs: 0 });

await sandbox.files.write('/data/inbox/job-1.json', '{"id":1}');
// ……处理事件……
await watcher.stop();
```

- 只支持非递归监视：子目录自身的新建、删除、改名会报告，子目录里的变化不报告。`recursive: true` 返回 `unimplemented`。`allowNetworkMounts` 被忽略。
- 事件类型有 `CREATE`、`WRITE`、`CHMOD`、`REMOVE`、`RENAME`，`name` 是条目相对于被监视目录的名字。
- `includeEntry: true` 时，`CREATE`、`WRITE`、`CHMOD` 事件带上条目信息；条目已经不在时不带，`REMOVE` 事件也不带。
- 监视开始之后、结束之前，目录里的每一次变化至少产生一个事件，相邻的相同变化可能只报一次。
- 监视不会以成功结束。它在这些情况下结束，SDK 的 `onExit` 收到对应的错误：目录被删除、移走或所在文件系统被卸载（`not_found`）；sandbox 里的事件来不及送达（`resource_exhausted`）；调用方停止读取超过 5 秒；sandbox 暂停、停止或删除。
- 需要目录的完整状态时，先开始监视，再用 `files.list()` 取一次全量。顺序反过来，两者之间发生的变化可能既不在列表里，也没有事件。监视结束后按同样的顺序重来。
- 每个 sandbox 最多 64 条监视，每条每秒最多送出 1000 个事件，空闲时每 10 秒一条心跳。

结束原因与限制的完整说明见[目录监视](/integrate/native-api/data-plane#watch-dir)。

## 健康检查 {#health}

`GET /health` 不需要 token，SDK 的 `isRunning()` 使用它：

| 状态码 | 含义 |
|---|---|
| 204 | sandbox 正在运行，能够服务请求 |
| 502 | sandbox 不存在、不属于本部署，或没有在运行（例如已暂停）。SDK 的 `isRunning()` 返回 `false` |
| 503 | 暂时无法判断 sandbox 的状态，稍后重试 |
| 400 | 请求里没有可识别的 sandbox |

## 不支持的方法 {#unsupported-methods}

| 方法或用法 | 结果 |
|---|---|
| `/process.Process/List`（列出进程） | `unimplemented` |
| `/process.Process/StreamInput`（客户端流式输入） | `unimplemented`，用 `SendInput` 代替 |
| 按 `tag` 选择进程 | `invalid_argument`，只能按 PID |
| `SIGTERM`、`SIGKILL` 以外的信号 | `invalid_argument` |
| `/filesystem.Filesystem/CreateWatcher`、`GetWatcherEvents`、`RemoveWatcher` | `unimplemented`：它们要求网关跨请求保存监视状态，而网关不保存状态。用 `WatchDir` 代替 |
| `WatchDir` 的 `recursive: true` | `unimplemented` |

## 相关文档 {#related}

- [数据面：文件与进程](/integrate/native-api/data-plane)：原生层面的进程、文件与资源上限。
- [暂停与恢复](/integrate/e2b/pause-resume)：暂停后进程与连接的去向。
- [应用端口与桌面](/integrate/e2b/ports)：访问 sandbox 里运行的服务。
- [与 E2B 的差异](/integrate/e2b/differences)
