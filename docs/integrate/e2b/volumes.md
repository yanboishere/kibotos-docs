---
title: Volume
description: 通过 E2B 兼容 API 使用 Volume：sandbox 自带的 /data Volume 与按名称创建的独立 Volume，创建语义、失败处理、挂载、回显与删除。
---

# Volume

本页说明怎样用 Volume 保存需要可靠保留的数据：每个 sandbox 自带的 `/data` Volume，以及按名称创建、可以先后挂到不同 sandbox 的独立 Volume。读者是需要让 Agent 的工作成果跨暂停、跨 sandbox 保留的开发者。

Volume 是 Kibotos 承诺保留数据的地方。根文件系统上的修改只是尽力保留，见[暂停与恢复](/integrate/e2b/pause-resume)。

## 两种 Volume {#kinds}

| | sandbox 自带的 Volume | 独立 Volume |
|---|---|---|
| 怎样得到 | 创建 sandbox 时没有指定 `volumeMounts`，自动创建 | 用 `POST /volumes`（`Volume.create()`）按名称创建，创建 sandbox 时用 `volumeMounts` 挂载 |
| 挂载路径 | `/data` | `volumeMounts` 指定的路径 |
| 删除 sandbox 时 | 随之删除 | 保留，需要显式删除 |
| 在多个 sandbox 之间使用 | 不能 | 可以先后挂到不同的 sandbox |
| 出现在 `volumeMounts` 回显与 `GET /volumes` | 不出现 | 出现 |
| 容量 | 取决于部署配置 | 取决于部署配置 |

两种 Volume 的共同点：

- 暂停再恢复后，里面的数据都保留。
- 挂载点归 Template 声明的默认账号所有，默认账号可以直接读写。
- 每个 sandbox 至多挂载一个 Volume。挂载独立 Volume 时，它取代自带的 `/data` Volume：这个 sandbox 只有这一个 Volume，`/data`（如果没有挂在这里）只是根文件系统上的普通目录。
- Volume 的内容通过挂载它的 sandbox 读写。网关只提供下文的四个 Volume 接口，不提供直接读写 Volume 内容的接口。

## 创建独立 Volume {#create}

`POST /volumes` 按名称创建独立 Volume，成功返回 201，响应体是 `{"volumeID": "vol-01k6...", "name": "agent-ws-42"}`：

```bash
curl -sS -X POST "$E2B_API_URL/volumes" \
  -H "X-API-Key: $(cat "$E2B_API_KEY_FILE")" \
  -H 'Content-Type: application/json' \
  --data '{"name":"agent-ws-42"}'
```

名称规则：非空，首尾没有空白，最长 253 字节，不含 `/`、NUL、回车与换行，否则返回 400 `valid volume name is required`。名称在同一部署内唯一，另一个部署命名空间里的同名 Volume 互不相干。

同一个名称同时只由一个 Volume 持有。`POST /volumes` 的结果取决于这个名称下最新的、未删除的 Volume：

| 名下最新的 Volume | `POST /volumes` 的结果 |
|---|---|
| 没有 | 新建一个，返回 201 |
| 可用、已挂载或正在扩容 | 返回它，201 |
| 正在创建 | 等创建完成后返回 201 |
| 创建失败 | 删除它再新建一个。新建成功返回 201；容量仍不足返回 503，消息含 `resource_exhausted`；其他原因失败按原因返回 409 或 502，消息带原因 |
| 扩容或删除失败 | 409，消息带 Volume ID 与失败原因 |
| 存储池已丢失（`LOST`） | 409，消息说明删除它才能释放这个名称 |
| 结果未知 | 重放当初的创建。仍然未知时返回 409，消息带原因 |
| 正在删除 | 409 `volume deletion is pending`，稍后重试 |

- `POST /volumes` 本身是幂等的：同名的重复请求和并发请求拿到的是同一个 Volume，多个网关实例同时创建也只创建一个。
- 删除之后，同一个名称可以再次创建，得到一个新的、空的 Volume。

## 失败的 Volume {#failed}

- **创建失败的 Volume** 从未可用，没有数据，所以由下一次同名创建替换，不需要先删除。因容量不足没能创建时，容量恢复后同一个请求即返回 201。
- **扩容或删除失败的 Volume** 可能还有数据，网关不替你删除它。要重建，先用 `DELETE /volumes/{id}` 删除它，数据随之丢弃，再按名称创建。
- **存储池已丢失（`LOST`）的 Volume** 只在平台运营方宣告存储池丢失后出现，数据取不回来。挂载它的 sandbox 无法再启动，`connect` 返回 409，重试不会成功。删除它之后才能重新使用这个名称。
- 创建 sandbox 时，`volumeMounts` 指向失败或已丢失的 Volume 返回 409，消息带失败原因。

## 挂载到 sandbox {#mount}

创建 sandbox 时用 `volumeMounts` 挂载独立 Volume。SDK 里可以传 `Volume` 对象或 Volume 名称：

::: code-group
```javascript [Volume 对象]
// volume 是 Volume.create() 或 Volume.connect() 的返回值
const sandbox = await Sandbox.create('kibotos-minimal', {
  ...config,
  volumeMounts: { '/data': volume },
});
```
```javascript [Volume 名称]
// 按名称挂载，挂在 /workspace
const sandbox = await Sandbox.create('kibotos-minimal', {
  ...config,
  volumeMounts: { '/workspace': 'agent-ws-42' },
});
```
:::

REST 的写法是 `"volumeMounts": [{"name": "agent-ws-42", "path": "/data"}]`。规则：

- 至多一项，多于一项返回 400。
- `path` 必须是规范的绝对路径：以 `/` 开头，不以 `/` 结尾，不含 `.` 或 `..` 段，不能是 `/`。否则返回 400。
- 按名称在本部署内查找 Volume，找不到返回 404。
- Volume 正在创建时，网关等它完成。Volume 正在扩容、正在删除、创建失败、扩容或删除失败、存储池已丢失时返回 409。
- 一个 Volume 同一时间只能被一个未删除的 sandbox 挂载，暂停中的 sandbox 也算。挂载已被其他 sandbox 挂载的 Volume 返回 409。
- 挂载只能在创建时指定。之后暂停、恢复都重新挂载同一个 Volume。

## 回显 {#echo}

查询与列表的 `volumeMounts` 回显挂载的独立 Volume：

- 内容是 Volume 名称与挂载路径，例如 `[{"name": "agent-ws-42", "path": "/data"}]`，字段只有 `name` 与 `path`，`name` 是名称而不是 Volume ID。删除 sandbox 后再挂到新的 sandbox，回显不变。
- 没有挂载独立 Volume 的 sandbox 回显空数组，自带的 `/data` Volume 不出现在这里。
- 挂载的 Volume 已被删除、处于不可用状态时，`GET /sandboxes/{id}` 返回 500，不会误报为 sandbox 不存在；列表对同一种情况照常列出 sandbox，`volumeMounts` 为空数组。
- SDK 的 `getInfo()` 与列表都保留 `volumeMounts`。

## 查询、列表与删除 {#inspect-delete}

| 请求 | SDK | 结果 |
|---|---|---|
| `GET /volumes` | `Volume.list(config)` | 本部署的全部独立 Volume，每项 `{"volumeID", "name"}`，按名称排序。正在删除的不列出 |
| `GET /volumes/{id}` | `Volume.getInfo(id, config)` | `{"volumeID", "name"}`。不存在、已删除、不属于本部署或 ID 格式不合法时返回 404 |
| `DELETE /volumes/{id}` | `Volume.destroy(id, config)` | 确认删除完成后返回 204，最长等待约 90 秒，SDK 返回 `true`。Volume 仍挂在某个 sandbox 上（包括暂停中的）时返回 409 `volume is bound to a sandbox` |

- 删除 Volume 会丢弃其中的全部数据，无法恢复。
- 要删除挂在 sandbox 上的 Volume，先删除那个 sandbox。删除 sandbox 只解除挂载，不删除独立 Volume。

## SDK 示例 {#examples}

下面的程序创建一个独立 Volume，挂到第一个 sandbox 写入文件，删除这个 sandbox 后把同一个 Volume 挂到第二个 sandbox 读回文件，最后删除 Volume。`config` 的写法见[快速开始](/quickstart/e2b-sdk)：

```javascript
import { Sandbox, Volume } from 'e2b';

const template = process.env.E2B_TEMPLATE || 'kibotos-minimal';
const options = { ...config, timeoutMs: 30 * 60_000, lifecycle: { onTimeout: 'kill', autoResume: false } };

const volume = await Volume.create('agent-ws-42', config);
console.log('volume:', volume.volumeId);

const first = await Sandbox.create(template, { ...options, volumeMounts: { '/data': volume } });
await first.files.write('/data/notes.md', '# notes\n');
console.log((await first.getInfo()).volumeMounts); // [ { name: 'agent-ws-42', path: '/data' } ]
await first.kill(); // 独立 Volume 保留

const second = await Sandbox.create(template, { ...options, volumeMounts: { '/data': 'agent-ws-42' } });
console.log(await second.files.read('/data/notes.md'));
await second.kill();

console.log((await Volume.getInfo(volume.volumeId, config)).name);
for (const item of await Volume.list(config)) console.log(item.volumeId, item.name);
console.log(await Volume.destroy(volume.volumeId, config)); // true
```

## 相关文档 {#related}

- [暂停与恢复](/integrate/e2b/pause-resume)：冷暂停保留哪些数据。
- [sandbox 生命周期](/integrate/e2b/sandboxes)：创建参数与删除。
- [Volume 与 Transfer](/integrate/native-api/volumes-transfers)：原生层面的 Volume。
- [数据持久性与保护](/security/data)
