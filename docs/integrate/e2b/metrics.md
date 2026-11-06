---
title: sandbox 指标
description: 通过 E2B 兼容 API 读取 sandbox 的 CPU、内存与磁盘读数：可用性、两个接口、样本字段、时间范围与分桶、查询延迟、批量接口的限制与 E2B 的差异。
---

# sandbox 指标

本页说明怎样读取 sandbox 的 CPU、内存与根文件系统读数，用于在你的产品里展示 sandbox 的运行状况、发现资源吃紧的 sandbox。读者是使用 SDK 的 `getMetrics()` 或直接调用指标接口的开发者。

::: warning 注意
指标只用于观察，不是用量或计费数据。指标存储不可达、guest 没有按时应答或 node 重启时，对应时段的样本会缺失，之后不会补写。不要用它计量或计费。
:::

## 可用性 {#availability}

sandbox 指标依赖部署接入的实例指标存储，取决于部署配置，可以向平台运营方确认。

- 部署接入了指标存储时，网关提供下文的两个接口。
- 没有接入时，两个接口都返回 501，能力名 `metrics`，消息为 `unimplemented: metrics is not supported by the core gateway`。SDK 抛出 `SandboxError`，消息以 `501: ` 开头。
- sandbox 使用的 Platform 早于采样功能时，node 不采样它，查询返回空数组。

## 接口 {#endpoints}

| 请求 | SDK | 返回 |
|---|---|---|
| `GET /sandboxes/{id}/metrics` | `sandbox.getMetrics()`、`Sandbox.getMetrics(id, config)` | 一个 sandbox 按时间分桶的样本数组，按时间升序。可带 `start`、`end`，单位是 Unix 秒 |
| `GET /sandboxes/metrics?sandbox_ids=...` | 无 | 每个 sandbox 最近的一个样本，形如 `{"sandboxes": {"<sandboxID>": {样本}}}` |

```javascript
// 运行中的 sandbox
const samples = await sandbox.getMetrics();
const latest = samples.at(-1);
if (latest) console.log(latest.cpuUsedPct, latest.memUsed, latest.diskUsed);

// 只知道 ID 时，包括已经删除的 sandbox
const history = await Sandbox.getMetrics('ws-01k6zq7v0f3m2r8t9x4y5n6p7c', config);
console.log(history.length);
```

用 REST 读取最近 10 分钟的样本：

```bash
curl -sS -G "$E2B_API_URL/sandboxes/$sandbox_id/metrics" \
  -H "X-API-Key: $(cat "$E2B_API_KEY_FILE")" \
  --data-urlencode "start=$(( $(date +%s) - 600 ))"
```

一次读取多个 sandbox 的最新样本：

```bash
curl -sS -G "$E2B_API_URL/sandboxes/metrics" \
  -H "X-API-Key: $(cat "$E2B_API_KEY_FILE")" \
  --data-urlencode "sandbox_ids=$sandbox_a,$sandbox_b"
```

上面两例中的 `sandbox_id`、`sandbox_a`、`sandbox_b` 是 sandbox ID。

## 样本字段 {#fields}

| 字段 | 含义 |
|---|---|
| `cpuCount` | guest 在线的 CPU 数 |
| `cpuUsedPct` | 相邻两次采样之间全部 CPU 的忙碌占比，0 到 100 |
| `memTotal` | guest `/proc/meminfo` 的 `MemTotal`，单位字节 |
| `memUsed` | `MemTotal` 减 `MemAvailable`，单位字节 |
| `memCache` | `/proc/meminfo` 的 `Cached`，单位字节 |
| `diskTotal`、`diskUsed` | guest 根文件系统 `/` 的总容量与已用量（总量减可用量），单位字节。不包括 Volume |
| `timestamp`、`timestampUnix` | 桶的起点，分别是 UTC 的 RFC 3339 时间与 Unix 秒 |

SDK 返回的样本里，`timestamp` 已转换为 `Date`，不保留 `timestampUnix`。

## 时间范围与分桶 {#range-and-buckets}

- **采样。** node 每 5 秒采样一次每个运行中的 sandbox。sandbox 启动或恢复后，从第二次采样起才有样本：第一次只建立 CPU 的基准。
- **默认范围。** 不带 `start`、`end` 时，返回保留期内这个 sandbox 的全部历史。只给一端时，另一端取 sandbox 历史的起点或终点。终点不晚于当前时间，起点不早于保留期的开端。
- **保留期。** 默认 7 天，取决于部署配置。
- **参数校验。** `start`、`end` 必须是非负整数，`start` 晚于 `end` 时返回 400。
- **桶宽。** 按查询的时间跨度选取，与 E2B 相同：

| 跨度 | 桶宽 |
|---|---|
| 小于 1 小时 | 5 秒 |
| 小于 6 小时 | 30 秒 |
| 小于 12 小时 | 1 分钟 |
| 小于 24 小时 | 2 分钟 |
| 小于 7 天 | 5 分钟 |
| 7 天及以上 | 15 分钟 |

- **桶的取值。** 每个桶的每个字段取桶内样本的最大值，时间戳是桶的起点。七个字段都有值的桶才会返回。第一个和最后一个桶都是完整的桶，可能包含 `[start, end]` 之外、紧邻两端的样本。
- **暂停与恢复。** 暂停再恢复后仍是同一条序列，暂停期间没有样本。
- **删除之后。** sandbox 删除后，保留期内仍可查询它的指标。
- **不存在的 sandbox。** 不存在的 sandbox、属于另一个部署命名空间的 sandbox 返回 404。存在但还没有样本的 sandbox 返回空数组。

## 查询延迟 {#query-delay}

网关只返回已经确定的数据：

- 只返回已经结束、且结束时刻不晚于「当前时间减去查询延迟」的桶。查询延迟默认 30 秒，取决于部署配置。所以一个样本大约半分钟后才查得到，单个 sandbox 最后一个桶至少在查询延迟之前就已结束。
- 批量接口的最新样本截至「当前时间减去查询延迟」，通常是 30 到 60 秒之前的。
- 每个网关实例把单个 sandbox 的查询结果缓存 1 秒，更频繁的轮询得到相同的结果。

## 批量接口 {#batch}

- `sandbox_ids` 用逗号分隔，最多 100 个，不能重复。缺失或为空时返回 400，超过 100 个或有重复时同样返回 400。
- 每个 sandbox 返回截至「当前时间减去查询延迟」的最新样本。在这个时刻之前 30 秒内没有样本的 sandbox 不出现在结果里，例如已暂停、已删除或刚刚启动的 sandbox。
- 不存在的、属于其他部署的、ID 格式不合法的 sandbox 同样不出现在结果里，请求照常返回 200。

## 错误 {#errors}

| 状态码 | 含义 |
|---|---|
| 400 | 参数不合法，例如 `start` 不是非负整数、`start` 晚于 `end`、`sandbox_ids` 缺失或超过 100 个 |
| 404 | 单个 sandbox 的接口：sandbox 不存在或属于其他部署 |
| 500 | 指标存储不可用，消息为 `failed to fetch sandbox metrics`。稍后重试 |
| 501 | 部署没有接入实例指标存储，能力名 `metrics` |

## 与 E2B 的差异 {#differences}

- 团队指标（`GET /teams/{teamID}/metrics` 与 `GET /teams/{teamID}/metrics/max`）不提供，返回 501，能力名 `team metrics`：API key 由整个部署共用，没有可统计的团队。
- 最新约 30 秒的样本要等指标存储确定后才返回，见[查询延迟](#query-delay)。
- 批量接口只返回查询延迟之前 30 秒内有样本的 sandbox。
- 第一个和最后一个桶都是完整的桶，可能包含请求范围之外、紧邻两端的样本。
- sandbox 所用 Platform 的 guest 早于采样功能时，查询返回空数组。

## 相关文档 {#related}

- [运行状况观测](/integrate/native-api/observability)：原生 API 提供的 guest 回应情况与内存饱和观测。
- [与 E2B 的差异](/integrate/e2b/differences)
- [sandbox 生命周期](/integrate/e2b/sandboxes)
