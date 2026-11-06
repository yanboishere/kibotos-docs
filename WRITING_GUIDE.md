# Kibotos 企业客户文档写作规范

本文件约定 `docs/` 下每一页怎样写。所有撰写者都按它写，保证全站口径一致。

事实来源：Kibotos 实现仓库（Go module `github.com/memohai/kibotos`），本站内容对应 v0.3.0。
文档站（VitePress）：本仓库的 `docs/` 目录。

## 1. 读者与范围

读者是**企业客户**，他们使用由平台运营方（通常是 Kibotos 团队）运营的 Kibotos 部署：

| 读者 | 关心什么 |
|---|---|
| 接入开发者 | 怎样把 Workspace / sandbox 接进自己的 AI Agent 产品：SDK、API、CLI、错误处理 |
| 技术负责人、架构师 | 产品能力、架构、隔离与安全、版本与兼容承诺、限制 |
| 安全与合规评审 | 身份、凭证、隔离、网络、数据持久性 |

**本站不包含自部署（私有化部署）内容。** 不写：

- 安装、配置、升级、卸载 ctrl / node / E2B 网关 / Exposure 网关；宿主机要求（KVM、AppArmor、时间同步）；Debian 包；容器与 Kubernetes 部署；数据库与对象存储的准备。
- 运营方的运维操作：node 的 drain / isolate / retire、超卖、存储池容量与搬迁、宣告池丢失、制品回收、Platform 批准、日志 / 指标 / Trace 基础设施与 Grafana 看板。
- 贡献者内容：`mise` 任务、本地开发栈（`.cache/kibotos-dev`）、从源码构建发布包、`kibo-dev verify`、conformance runner、Go 包结构、CI、设计讨论。

用「**平台运营方**」指运营客户所接入部署的团队。行为取决于部署配置时，写明默认值（如有）并写「取决于部署配置，可向平台运营方确认」，例如：E2B 网关的默认资源与最长有效期、是否开启 Exposure、是否接入 sandbox 指标、node 是否支持某项网络能力、Transfer 归档的保留期与大小上限。

## 2. 准确性（最重要）

- **只写能在源码仓库中找到依据的事实**：`docs/`、`proto/`、`config/`、`CHANGELOG.md`、`templates/`、`internal/`、`cmd/`。数值（上限、默认值、超时、端口、状态名、字段名、枚举值、错误码、HTTP 状态、退出码、能力名、命令与参数）逐字核对。
- 源文档与代码或 proto 冲突时，以代码 / proto 为准，并在交付报告里列出冲突。
- **不编造**：SLA、可用性承诺、价格与计费、性能数字、客户案例、合规认证、支持渠道、未提供的 SDK、未存在的命令 / 参数 / 字段、路线图与时间表。
- 当前版本 **v0.3.0**。仓库自述「尚未生产就绪」：不要写「生产级」「企业级稳定」之类的宣称。
- E2B 兼容：兼容目标是官方 JavaScript SDK `e2b@2.49.1`；当前验收基线是 `e2b@2.46.1`，`2.49.1` 尚未取得验收结论。验收口径只有 JS SDK；其他语言的 SDK 写「未经验收」。
- **暂停与恢复的口径**（必须遵守）：E2B 的 `pause` / `connect` 接口可用，接受 `memory:true`；内部统一是冷暂停（停止执行）与冷启动恢复。内存、进程与原有连接不保留；根文件系统的保留可写层只是尽力保留，可能重建，不是快照；承诺保留的数据要写进 Volume 挂载目录；`/tmp`、`/run` 不保留。不得宣称内存快照、快照恢复、克隆或跨节点恢复。
- 不引用私有仓库的 issue / PR 链接（`github.com/felinics/...`、`#123` 这类编号）。需要表达「尚未支持」时直接写「暂不支持」，不承诺时间。
- 内部实现细节（执行器、锁、数据库、网关内部 label 编码、node 内部进程）只在客户需要据此做判断或操作时才写，并写成效果而不是机制。

## 3. 语言与风格

沿用源码仓库 `docs/STYLE.md`，要点：

- 简体中文，陈述句。直接告诉读者做什么、会得到什么。先写正常路径，再写限制与失败情形。
- 一句话说一件事，一段话说一个主题。不写「不…、不…、也不…」式的排比禁令，把限制写成条件：「只有 … 时可以 …」「… 会失败并返回 …」。
- 不用内部口语：点名、兜底、收敛、落库、对账、认领、在途、旅程。
- 产品与组件名保留英文：Kibotos、Workspace、Template、Platform、Volume、Instance、Transfer、Exposure、Egress、Resolver、node、ctrl、guest、VMM、Operator、E2B、sandbox（E2B 语境）。
- 标识符、命令、参数、字段名、状态值、能力名用反引号原样写：`kibo workspace create`、`--expected-revision`、`AVAILABLE`、`workspace.stop.force`。
- 其余概念用中文，第一次出现时括注英文，此后只用中文。全站统一译法：

| 中文 | 英文 / 代码 |
|---|---|
| 注册 / 注册密钥 | enrollment / enrollment key |
| 身份 | identity（ctrl 签发的客户端证书及信任锚） |
| 控制面 / 数据面 | control plane / data plane |
| 会话凭证 | data-plane session credential |
| 幂等键 | command ID，`command_id`，`--command-id` |
| 版本校验 | expected revision / version |
| 能力名 | capability |
| 执行代 | generation |
| 调度 | placement |
| 保留的可写层 | retained layer |
| 正在进行的 | in-flight |
| 平台运营方 | 运营部署的团队 |
| 调用方 / 接入方 | client |

- 中英文之间留一个空格；中文用全角标点；代码与英文之间的标点用半角。
- 二级标题用名词或名词短语，不用问句和口语。

## 4. 页面结构

每页以 frontmatter 开头：

```md
---
title: 页面标题
description: 一句话说明本页内容，用于搜索结果与链接预览。
---
```

- 正文第一行是一级标题，与 `title` 相同。
- 标题下用一两句话说明本页解决什么问题、给谁看。
- 按需使用这些固定节名：概述、前提条件、步骤、参数、注意、排查、下一步。参考类页面可以按对象分节。
- 页末用「下一步」或「相关文档」列出两到五个站内链接。
- 同一件事只在一处详细写，其他地方链接过去。参考表（上限、错误码、能力名）集中在 `reference/` 下，指南页写到够用即可并链接过去。

## 5. 代码示例

- 命令必须能直接运行。占位值用有意义的示例：`node-a`、`ws-01k6...`、`sandbox.example.com`、`ctrl.example.com:18092`、`/data/report.txt`。不用尖括号占位符。shell 里可以用 `"$workspace_id"` 这样的变量，并在前文说明它从哪来。
- JS 示例使用官方 `e2b` 包的真实 API；不确定某个 SDK 方法或参数是否存在时，查 `conformance/e2b-js/` 下的测试代码，查不到就不写。
- 不在示例里写真实密钥。API key 从文件或环境变量读取。
- 代码块标明语言：`bash`、`javascript`、`ts`、`go`、`json`、`toml`、`text`。

## 6. VitePress 语法

- 提示容器（中文标签已配置）：

  ```md
  ::: tip
  建议的做法。
  :::

  ::: warning 注意
  容易出错、有副作用的地方。
  :::

  ::: danger
  会丢数据或有安全风险的操作。
  :::

  ::: details 展开查看完整字段
  ...
  :::
  ```

- 代码组：

  ````md
  ::: code-group
  ```bash [kibo]
  kibo workspace get "$workspace_id"
  ```
  ```bash [curl]
  curl ...
  ```
  :::
  ````

- 图：已启用 mermaid，代码块语言写 `mermaid`。用于架构、时序与状态机，每页不超过两张，节点文字用中文。
- 版本徽章：`<Badge type="tip" text="v0.3.0 新增" />` 标在标题或表格单元里，只用于标注引入版本。
- 表格用 GFM 语法。

## 7. 链接与锚点

- 站内链接用绝对路径、不带扩展名：`[调用约定](/integrate/native-api/conventions)`。
- 自己负责的页面里，所有二级、三级标题都加英文自定义锚点：`## 版本校验 {#expected-revision}`。锚点用小写 kebab-case。
- 跨页链接只能带下表列出的约定锚点；其他跨页链接只链接到页面本身。修改这些页面时**必须**保留这些锚点。新增约定锚点时补进这张表。

| 页面 | 必须提供的锚点 |
|---|---|
| `/integrate/native-api/conventions` | `#capabilities`（能力协商）、`#idempotency`（幂等键）、`#expected-revision`（版本校验）、`#errors`（错误格式） |
| `/integrate/native-api/data-plane` | `#session`（申请会话凭证）、`#files-http`（/v1/files）、`#process-resume`（进程流续传）、`#watch-dir`（目录监视）、`#guest-limits`（guest 内的资源上限） |
| `/integrate/native-api/workspaces` | `#create`、`#force-stop`（强制停止）、`#expiration`（到期）、`#labels-annotations`、`#resources`（调整资源）、`#volume-binding` |
| `/integrate/native-api/network-policy` | `#dns`、`#destination-rules`（allow / deny 判定） |
| `/integrate/native-api/observability` | `#guest-observation`、`#memory-saturation`、`#stop-cause`、`#guest-reboot`（guest 自己重启或关机）、`#cleanup` |
| `/integrate/e2b/pause-resume` | `#capacity`（容量不足时的恢复） |
| `/integrate/e2b/network` | `#egress-proxy` |
| `/integrate/e2b/differences` | `#unsupported`（明确未提供的能力）、`#status-codes`（HTTP 状态码） |
| `/integrate/kibo/workspaces` | `#create`、`#wait`（等待与查询结果）、`#expiration` |
| `/reference/kibo-cli` | `#global-flags`、`#exit-codes`、`#json-output` |
| `/reference/errors` | `#native`、`#files-http`、`#kibo-exit-codes`、`#e2b` |
| `/templates/custom` | `#definition`（Template 定义文件）、`#publish`（发布与批准） |

## 8. 全站页面清单

链接只指向下表中的页面。

| 路径 | 标题 |
|---|---|
| `/` | 首页 |
| `/guide/introduction` | Kibotos 是什么 |
| `/guide/use-cases` | 典型场景 |
| `/guide/memoh` | Kibotos 与 Memoh |
| `/guide/architecture` | 系统架构 |
| `/guide/concepts` | 核心概念 |
| `/guide/workspace-lifecycle` | Workspace 生命周期 |
| `/guide/maturity` | 版本状态与支持范围 |
| `/quickstart/` | 选择接入方式 |
| `/quickstart/e2b-sdk` | 通过 E2B SDK 接入 |
| `/quickstart/kibo-cli` | 通过 kibo 命令行 |
| `/quickstart/native-api` | 通过原生 API |
| `/integrate/e2b/overview` | 概述与兼容范围 |
| `/integrate/e2b/sandboxes` | sandbox 生命周期 |
| `/integrate/e2b/pause-resume` | 暂停与恢复 |
| `/integrate/e2b/commands-files` | 命令、终端与文件 |
| `/integrate/e2b/volumes` | Volume |
| `/integrate/e2b/network` | 出网策略与出站代理 |
| `/integrate/e2b/ports` | 应用端口与桌面 |
| `/integrate/e2b/metrics` | sandbox 指标 |
| `/integrate/e2b/differences` | 与 E2B 的差异 |
| `/integrate/native-api/overview` | 概述与协议 |
| `/integrate/native-api/authentication` | 身份与认证 |
| `/integrate/native-api/conventions` | 调用约定 |
| `/integrate/native-api/workspaces` | Workspace |
| `/integrate/native-api/volumes-transfers` | Volume 与 Transfer |
| `/integrate/native-api/network-policy` | 网络策略与 DNS |
| `/integrate/native-api/egress-resolver` | Egress 与 Resolver |
| `/integrate/native-api/data-plane` | 数据面：文件与进程 |
| `/integrate/native-api/desktop-services` | 桌面与服务连接 |
| `/integrate/native-api/exposure` | 公开 URL（Exposure） |
| `/integrate/native-api/observability` | 运行状况观测 |
| `/integrate/kibo/setup` | 安装与连接 |
| `/integrate/kibo/workspaces` | 管理 Workspace |
| `/integrate/kibo/network` | 网络、Egress 与 Resolver |
| `/integrate/kibo/storage` | Volume 与数据迁移 |
| `/integrate/kibo/services` | 端口、公开 URL 与桌面 |
| `/integrate/best-practices` | 集成最佳实践 |
| `/integrate/troubleshooting` | 常见问题排查 |
| `/templates/overview` | Template 与 Platform |
| `/templates/builtin` | 内置 Template |
| `/templates/custom` | 自定义 Template |
| `/templates/oci-import` | 导入现有容器镜像 |
| `/templates/desktop` | 桌面 Template 规范 |
| `/security/overview` | 安全模型 |
| `/security/credentials` | 身份、凭证与访问控制 |
| `/security/isolation` | 隔离与网络安全 |
| `/security/data` | 数据持久性与保护 |
| `/reference/kibo-cli` | kibo 命令参考 |
| `/reference/capabilities` | 能力名清单 |
| `/reference/errors` | 错误码 |
| `/reference/limits` | 限制与默认值 |
| `/reference/glossary` | 术语表 |
| `/releases/compatibility` | 兼容策略 |
| `/releases/changelog` | 变更记录 |
| `/help/faq` | 常见问题 |
| `/help/support` | 获取支持 |

文件路径：页面 `/a/b` 写到 `docs/a/b.md`；`/quickstart/` 是 `docs/quickstart/index.md`。

## 9. 修改后的检查

- `npm run build`：链接到不存在的页面会让构建失败。
- `npm run check:anchors`：检查站内链接的 `#锚点` 是否都存在，VitePress 本身不检查锚点。
- 新增页面时同时更新第 8 节的清单与 `docs/.vitepress/config.mts` 的侧边栏。
- 依据源码修改了与源文档不一致的事实时，在提交说明里写明依据的代码位置，便于之后核对。
