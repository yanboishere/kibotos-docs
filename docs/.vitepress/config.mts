import { defineConfig, type DefaultTheme } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const guideSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '产品概览',
    items: [
      { text: 'Kibotos 是什么', link: '/guide/introduction' },
      { text: '典型场景', link: '/guide/use-cases' },
      { text: 'Kibotos 与 Memoh', link: '/guide/memoh' },
      { text: '系统架构', link: '/guide/architecture' },
      { text: '核心概念', link: '/guide/concepts' },
      { text: 'Workspace 生命周期', link: '/guide/workspace-lifecycle' },
      { text: '版本状态与支持范围', link: '/guide/maturity' }
    ]
  },
  {
    text: '快速开始',
    items: [
      { text: '选择接入方式', link: '/quickstart/' },
      { text: '通过 E2B SDK 接入', link: '/quickstart/e2b-sdk' },
      { text: '通过 kibo 命令行', link: '/quickstart/kibo-cli' },
      { text: '通过原生 API', link: '/quickstart/native-api' }
    ]
  }
]

const integrateSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'E2B 兼容 API',
    collapsed: false,
    items: [
      { text: '概述与兼容范围', link: '/integrate/e2b/overview' },
      { text: 'sandbox 生命周期', link: '/integrate/e2b/sandboxes' },
      { text: '暂停与恢复', link: '/integrate/e2b/pause-resume' },
      { text: '命令、终端与文件', link: '/integrate/e2b/commands-files' },
      { text: 'Volume', link: '/integrate/e2b/volumes' },
      { text: '出网策略与出站代理', link: '/integrate/e2b/network' },
      { text: '应用端口与桌面', link: '/integrate/e2b/ports' },
      { text: 'sandbox 指标', link: '/integrate/e2b/metrics' },
      { text: '与 E2B 的差异', link: '/integrate/e2b/differences' }
    ]
  },
  {
    text: '原生 API',
    collapsed: false,
    items: [
      { text: '概述与协议', link: '/integrate/native-api/overview' },
      { text: '身份与认证', link: '/integrate/native-api/authentication' },
      { text: '调用约定', link: '/integrate/native-api/conventions' },
      { text: 'Workspace', link: '/integrate/native-api/workspaces' },
      { text: 'Volume 与 Transfer', link: '/integrate/native-api/volumes-transfers' },
      { text: '网络策略与 DNS', link: '/integrate/native-api/network-policy' },
      { text: 'Egress 与 Resolver', link: '/integrate/native-api/egress-resolver' },
      { text: '数据面：文件与进程', link: '/integrate/native-api/data-plane' },
      { text: '桌面与服务连接', link: '/integrate/native-api/desktop-services' },
      { text: '公开 URL（Exposure）', link: '/integrate/native-api/exposure' },
      { text: '运行状况观测', link: '/integrate/native-api/observability' }
    ]
  },
  {
    text: 'kibo 命令行',
    collapsed: false,
    items: [
      { text: '安装与连接', link: '/integrate/kibo/setup' },
      { text: '管理 Workspace', link: '/integrate/kibo/workspaces' },
      { text: '网络、Egress 与 Resolver', link: '/integrate/kibo/network' },
      { text: 'Volume 与数据迁移', link: '/integrate/kibo/storage' },
      { text: '端口、公开 URL 与桌面', link: '/integrate/kibo/services' }
    ]
  },
  {
    text: '实践',
    items: [
      { text: '集成最佳实践', link: '/integrate/best-practices' },
      { text: '常见问题排查', link: '/integrate/troubleshooting' }
    ]
  }
]

const templatesSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Template',
    items: [
      { text: 'Template 与 Platform', link: '/templates/overview' },
      { text: '内置 Template', link: '/templates/builtin' },
      { text: '自定义 Template', link: '/templates/custom' },
      { text: '导入现有容器镜像', link: '/templates/oci-import' },
      { text: '桌面 Template 规范', link: '/templates/desktop' }
    ]
  }
]

const securitySidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '安全',
    items: [
      { text: '安全模型', link: '/security/overview' },
      { text: '身份、凭证与访问控制', link: '/security/credentials' },
      { text: '隔离与网络安全', link: '/security/isolation' },
      { text: '数据持久性与保护', link: '/security/data' }
    ]
  }
]

const referenceSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '参考',
    items: [
      { text: 'kibo 命令参考', link: '/reference/kibo-cli' },
      { text: '能力名清单', link: '/reference/capabilities' },
      { text: '错误码', link: '/reference/errors' },
      { text: '限制与默认值', link: '/reference/limits' },
      { text: '术语表', link: '/reference/glossary' }
    ]
  },
  {
    text: '版本',
    items: [
      { text: '兼容策略', link: '/releases/compatibility' },
      { text: '变更记录', link: '/releases/changelog' }
    ]
  },
  {
    text: '帮助',
    items: [
      { text: '常见问题', link: '/help/faq' },
      { text: '常见问题排查', link: '/integrate/troubleshooting' },
      { text: '获取支持', link: '/help/support' }
    ]
  }
]

export default withMermaid({
  ...defineConfig({
    lang: 'zh-CN',
    title: 'Kibotos 文档',
    titleTemplate: ':title · Kibotos 文档',
    description: 'Kibotos：面向 AI Agent 的 MicroVM Workspace 执行栈。企业客户接入文档。',
    cleanUrls: true,
    lastUpdated: false,

    // mermaid splits each diagram type into its own chunk and loads it on
    // demand, and the search index loads only when search opens; neither is
    // on the initial page load.
    vite: {
      build: { chunkSizeWarningLimit: 1024 }
    },

    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
      ['meta', { name: 'theme-color', content: '#3b5bdb' }]
    ],

    markdown: {
      container: {
        tipLabel: '提示',
        warningLabel: '注意',
        dangerLabel: '警告',
        infoLabel: '说明',
        detailsLabel: '详细信息'
      }
    },

    themeConfig: {
      logo: '/logo.svg',
      siteTitle: 'Kibotos',

      nav: [
        { text: '产品概览', link: '/guide/introduction', activeMatch: '^/guide/' },
        { text: '快速开始', link: '/quickstart/', activeMatch: '^/quickstart/' },
        {
          text: '接入指南',
          activeMatch: '^/integrate/',
          items: [
            { text: 'E2B 兼容 API', link: '/integrate/e2b/overview' },
            { text: '原生 API', link: '/integrate/native-api/overview' },
            { text: 'kibo 命令行', link: '/integrate/kibo/setup' },
            { text: '集成最佳实践', link: '/integrate/best-practices' },
            { text: '常见问题排查', link: '/integrate/troubleshooting' }
          ]
        },
        { text: 'Template', link: '/templates/overview', activeMatch: '^/templates/' },
        { text: '安全', link: '/security/overview', activeMatch: '^/security/' },
        {
          text: '参考',
          activeMatch: '^/(reference|help)/',
          items: [
            { text: 'kibo 命令参考', link: '/reference/kibo-cli' },
            { text: '能力名清单', link: '/reference/capabilities' },
            { text: '错误码', link: '/reference/errors' },
            { text: '限制与默认值', link: '/reference/limits' },
            { text: '术语表', link: '/reference/glossary' },
            { text: '常见问题', link: '/help/faq' },
            { text: '获取支持', link: '/help/support' }
          ]
        },
        {
          text: 'v0.3.0',
          activeMatch: '^/releases/',
          items: [
            { text: '兼容策略', link: '/releases/compatibility' },
            { text: '变更记录', link: '/releases/changelog' }
          ]
        }
      ],

      sidebar: {
        '/guide/': guideSidebar,
        '/quickstart/': guideSidebar,
        '/integrate/': integrateSidebar,
        '/templates/': templatesSidebar,
        '/security/': securitySidebar,
        '/reference/': referenceSidebar,
        '/releases/': referenceSidebar,
        '/help/': referenceSidebar
      },

      outline: { level: [2, 3], label: '本页目录' },
      docFooter: { prev: '上一页', next: '下一页' },
      returnToTopLabel: '回到顶部',
      sidebarMenuLabel: '菜单',
      darkModeSwitchLabel: '外观',
      lightModeSwitchTitle: '切换到浅色模式',
      darkModeSwitchTitle: '切换到深色模式',
      langMenuLabel: '语言',
      skipToContentLabel: '跳到正文',
      notFound: {
        title: '页面不存在',
        quote: '这个地址没有对应的文档，可能已经移动或删除。',
        linkLabel: '返回首页',
        linkText: '返回首页'
      },

      footer: {
        message: 'Kibotos 文档 · 适用于 v0.3.0'
      },

      search: {
        provider: 'local',
        options: {
          translations: {
            button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
            modal: {
              displayDetails: '显示详细列表',
              resetButtonTitle: '清除查询条件',
              backButtonTitle: '关闭搜索',
              noResultsText: '没有找到相关结果',
              footer: {
                selectText: '选择',
                selectKeyAriaLabel: '回车',
                navigateText: '切换',
                navigateUpKeyAriaLabel: '上箭头',
                navigateDownKeyAriaLabel: '下箭头',
                closeText: '关闭',
                closeKeyAriaLabel: 'Esc'
              }
            }
          },
          miniSearch: {
            options: {
              // Chinese has no spaces between words, so the default tokenizer
              // would index whole clauses. Intl.Segmenter splits by word.
              // VitePress serializes this function to the client, so it must
              // not reference anything outside its own body.
              tokenize: (text: string) => {
                if (typeof Intl === 'undefined' || typeof (Intl as any).Segmenter !== 'function') {
                  return text.split(/[\s\p{P}\p{Z}]+/u).filter(Boolean)
                }
                const segmenter = new (Intl as any).Segmenter('zh-CN', { granularity: 'word' })
                const tokens: string[] = []
                for (const part of segmenter.segment(text)) {
                  if (part.isWordLike) tokens.push(part.segment)
                }
                return tokens
              }
            },
            searchOptions: {
              combineWith: 'AND',
              fuzzy: 0.1,
              prefix: true,
              boost: { title: 4, text: 2, titles: 1 }
            }
          }
        }
      }
    }
  }),

  // Light mode uses the base theme with the site palette; the plugin
  // switches to mermaid's own dark theme in dark mode.
  mermaid: {
    theme: 'base',
    themeVariables: {
      primaryColor: '#eef2ff',
      primaryBorderColor: '#5c7cfa',
      primaryTextColor: '#1f2937',
      secondaryColor: '#e3fafc',
      tertiaryColor: '#f8fafc',
      lineColor: '#64748b',
      clusterBkg: '#f8fafc',
      clusterBorder: '#cbd5e1',
      edgeLabelBackground: '#ffffff',
      fontSize: '15px'
    }
  }
})
