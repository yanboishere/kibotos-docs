# Kibotos 企业客户文档站

面向企业客户的 Kibotos 文档，用 [VitePress](https://vitepress.dev/)（基于 Vite）构建。内容依据 Kibotos 源码仓库 v0.3.0 编写，覆盖产品概览、快速开始、E2B 兼容 API、原生 API、`kibo` 命令行、Template、安全与参考，**不包含自部署内容**。

## 本地预览

需要 Node.js 18 或更新版本。

```bash
npm install
npm run dev        # http://localhost:5173 ，修改即时生效
```

## 构建与部署

```bash
npm run build          # 输出到 docs/.vitepress/dist，链接到不存在的页面会让构建失败
npm run check:anchors  # 检查站内链接的 #锚点 是否都存在（VitePress 本身不检查锚点）
npm run preview        # 本地预览构建结果
```

`docs/.vitepress/dist` 是纯静态文件，可以部署到任何静态托管（Nginx、对象存储 + CDN、GitHub Pages、Cloudflare Pages 等）。部署在子路径下时，在 `docs/.vitepress/config.mts` 里设置 `base`，例如 `base: '/docs/'`。

## 目录结构

```text
docs/
├── .vitepress/
│   ├── config.mts        # 站点配置：导航、侧边栏、中文搜索、mermaid
│   └── theme/            # 主题扩展与样式
├── public/               # logo、首页插图与图标
├── index.md              # 首页
├── guide/                # 产品概览：是什么、场景、Memoh、架构、概念、生命周期、版本状态
├── quickstart/           # 快速开始：选择接入方式、E2B SDK、kibo、原生 API
├── integrate/            # 接入指南：e2b/、native-api/、kibo/、最佳实践、排查
├── templates/            # Template 与 Platform、内置与自定义 Template
├── security/             # 安全模型、凭证、隔离、数据
├── reference/            # kibo 命令、能力名、错误码、限制、术语
├── releases/             # 兼容策略、变更记录
└── help/                 # 常见问题、获取支持
WRITING_GUIDE.md          # 写作规范：读者、范围、准确性、术语、页面结构、锚点约定
scripts/check-anchors.mjs # 锚点检查
```

## 写作约定

修改或新增页面前先读 [WRITING_GUIDE.md](WRITING_GUIDE.md)。要点：

- 只写能在 Kibotos 源码仓库中找到依据的事实；不写 SLA、价格、路线图等没有依据的内容。
- 用「平台运营方」指运营客户所接入部署的团队；因部署而异的行为写明默认值，并提示向平台运营方确认。
- E2B 的暂停与恢复按「接口可用、内部冷暂停与冷启动、不保留内存与进程」的口径描述。
- 二、三级标题加英文自定义锚点 `{#kebab-case}`；跨页锚点只用写作规范第 7 节列出的约定锚点。

## 随 Kibotos 版本更新

文档对应 Kibotos **v0.3.0**。新版本发布后：

1. 对照源码仓库 `CHANGELOG.md` 中新版本的「升级须知 · 调用方」与「新增」，更新 `releases/changelog.md` 与 `releases/compatibility.md`。
2. 新的能力名补进 `reference/capabilities.md`，新的上限与默认值补进 `reference/limits.md`。
3. 更新导航中的版本号（`config.mts` 的 `v0.3.0` 菜单）与页脚。
4. 运行 `npm run build` 与 `npm run check:anchors`。
