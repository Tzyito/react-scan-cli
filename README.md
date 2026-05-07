# react-scan-cli

自动检测 React 页面重渲染问题 + 定时功能巡检，结果写入 GitHub / GitLab Issues，支持 Vite 和 Next.js。

## 特性

- 装一个插件 + 复制一个 Actions 模板，20 分钟完成接入
- 通过 cookie 触发，不影响普通用户
- 检测结果自动写到指定仓库的 Issues，同一问题不重复创建，问题消失时自动关闭
- 支持功能巡检：模拟用户操作 + 断言关键页面行为，定时发现功能回归
- 支持 Vite、Next.js，GitLab 项目同样可用
- 完全基于 GitHub Actions，不需要额外服务器

---

## 快速接入

### Vite 项目

```bash
bun add -d @react-scan-cli/vite-plugin
```

```ts
// vite.config.ts
import { renderInspector } from '@react-scan-cli/vite-plugin'

export default {
  plugins: [renderInspector()],
}
```

### Next.js 项目

```bash
bun add -d @react-scan-cli/next
```

```ts
// next.config.ts
import { withRenderInspector } from '@react-scan-cli/next'

export default withRenderInspector({
  // 原有 nextConfig ...
})
```

---

### 配置 GitHub Actions

**1. 新建接收 Issue 的仓库**（例如 `your-org/perf-issues`），不需要任何配置。

**2. 添加 Secrets / Variables**

进入项目仓库 → Settings → Secrets and variables → Actions：

- **`REACT_SCAN_TOKEN`**（Secret）：GitHub Fine-grained PAT，需要目标仓库的 Issues 读写权限
- **`REACT_SCAN_CONFIG`**（Variable）：JSON 格式配置（见下方）

**3. 复制 workflow 文件**

把 `workflow-template/render-check.yml` 复制到 `.github/workflows/render-check.yml`。

完成。下周一凌晨自动首跑，也可以在 Actions 页面手动触发。

---

## REACT_SCAN_CONFIG

### 仅重渲染检测

```json
{
  "projectName": "my-project",
  "baseUrl": "https://example.com",
  "issueRepo": "your-org/perf-issues",
  "observeDuration": 8000,
  "threshold": 5,
  "pages": [
    { "name": "首页", "url": "/" },
    { "name": "社区", "url": "/zh-CN/topics" }
  ]
}
```

### 重渲染检测 + 功能巡检

在 `pages` 里添加 `assertions`，声明用户操作后的预期行为：

```json
{
  "projectName": "my-project",
  "baseUrl": "https://example.com",
  "issueRepo": "your-org/perf-issues",
  "pages": [
    {
      "name": "首页",
      "url": "/"
    },
    {
      "name": "登录流程",
      "url": "/login",
      "interactions": [
        { "type": "fill", "selector": "#email", "value": "test@example.com" },
        { "type": "fill", "selector": "#password", "value": "password" },
        { "type": "click", "selector": "[type=submit]" },
        { "type": "wait", "ms": 2000 }
      ],
      "assertions": [
        { "type": "url", "expected": "/dashboard" },
        { "type": "visible", "selector": ".user-avatar" }
      ]
    },
    {
      "name": "下单流程",
      "url": "/market/AAPL",
      "interactions": [
        { "type": "click", "selector": ".buy-btn" }
      ],
      "assertions": [
        { "type": "visible", "selector": ".order-panel" },
        { "type": "text", "selector": "h2", "contains": "买入" }
      ]
    }
  ]
}
```

### 断言类型

| 类型 | 字段 | 说明 |
|------|------|------|
| `url` | `expected` | 当前 URL 包含该值 |
| `visible` | `selector` | 元素在视口内可见 |
| `hidden` | `selector` | 元素不存在或不可见 |
| `text` | `selector` + `contains` | 元素文本包含该值 |
| `count` | `selector` + `expected` | 匹配到的元素数量等于预期值 |

---

## 配置项

### 插件配置（Vite / Next.js 一致）

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `triggerCookie` | `string` | `'__render_inspector__'` | 触发检测的 cookie 名称 |
| `threshold` | `number` | `5` | 重渲染次数阈值 |
| `enableInDev` | `boolean` | `true` | 开发环境是否自动开启 |

### REACT_SCAN_CONFIG 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `projectName` | `string` | ✓ | 项目名称，用于 issue 标题和 label |
| `baseUrl` | `string` | ✓ | 目标站点根地址 |
| `issueRepo` | `string` | ✓ | 接收 issue 的仓库，格式 `owner/repo` |
| `provider` | `'github' \| 'gitlab'` | — | 默认 `github` |
| `pages` | `PageConfig[]` | ✓ | 要检测的页面列表 |
| `observeDuration` | `number` | — | 每个页面观察多少毫秒，默认 `8000` |
| `threshold` | `number` | — | 超过多少次渲染算问题，默认 `5` |

---

## Issue 报告格式

每个被监控的页面对应一个 GitHub / GitLab Issue，Issue 会在每次扫描后自动更新，问题消失时自动关闭。

### Issue body — 当前完整状态

按检测到的问题分类展示，包含以下分类（有问题才出现）：

| 分类 | 检测来源 |
|------|---------|
| 🔁 重渲染问题 | `window.__renderInspector__`，精确到组件名 |
| 💥 代码报错 | Playwright `pageerror` 事件，从 stack trace 解析 React 组件名 |
| 🌐 接口报错 | 同源 HTTP 4xx / 5xx 响应 |
| 🔐 登录失败 | `authSetup` 抛出异常 |
| 📋 数据展示不全 | `assertions` 断言失败 |

Issue 标题示例：
```
[my-project] 首页 · 重渲染×3 · 接口报错×2
```

### 评论 — 每次扫描差量

每次扫描在 Issue 下追加一条差量评论，对比本次与上次的变化：

```
🔄 扫描更新 · Mon, 15 Jan 2024 02:00:00 GMT

| 分类           | 上次      | 本次      | 趋势      |
|---------------|-----------|-----------|-----------|
| 🔁 重渲染      | 5 个组件  | 3 个组件  | ⬇️ 好转   |
| 💥 代码报错    | 0         | 1         | ⚠️ 新增   |

🔁 重渲染
  消失: `Header` · `Sidebar`
  新增: `OrderPanel`

💥 代码报错
  新增: `Button` · `Form`
```

---

## 私有页面登录

```ts
import { run } from '@react-scan-cli/runner'

await run({
  projectName: 'my-project',
  baseUrl: 'https://example.com',
  issueRepo: 'your-org/perf-issues',
  githubToken: process.env.GITHUB_TOKEN!,
  pages: [{ name: '个人中心', url: '/profile' }],
  authSetup: async (page) => {
    await page.goto('https://example.com/login')
    await page.fill('#email', 'test@example.com')
    await page.fill('#password', 'password')
    await page.click('[type=submit]')
    await page.waitForURL('**/dashboard')
  },
})
```

---

## 工作原理

```
用户项目安装插件（Vite 或 Next.js）
  └── 注入检测脚本（cookie 触发，不影响普通用户）

GitHub Actions 定时触发（每周一凌晨）
  └── 安装 @react-scan-cli/runner
  └── 启动 Playwright 无头浏览器
  └── 注入 cookie __render_inspector__=true
  └── 访问每个页面，执行 interactions
  ├── 重渲染检测：读取 window.__renderInspector__ 数据
  └── 功能巡检：执行 assertions，记录失败项

写 GitHub / GitLab Issues
  └── 有问题（render 超标 或 assertion 失败）
      ├── 已有 open issue → 更新 body + 加评论
      └── 无 issue → 创建新 issue
  └── 无问题 → 自动关闭已有 open issue
```

---

## AI 引导接入

```bash
npx @react-scan-cli/skills
```

在 Claude Code 里运行 `/react-scan-cli`，AI 会引导你完成所有配置步骤。

---

## Packages

| 包 | 说明 |
|---|---|
| `@react-scan-cli/vite-plugin` | Vite 插件，注入检测脚本 |
| `@react-scan-cli/next` | Next.js 插件，`withRenderInspector` 包裹 nextConfig |
| `@react-scan-cli/runner` | CLI 工具，Playwright 采集 + Issues 写入 |
| `@react-scan-cli/skills` | Claude Code skill，AI 引导接入 |

---

## 本地调试

```bash
git clone https://github.com/Tzyito/react-scan-cli
cd react-scan-cli
bun install

export GITHUB_TOKEN=ghp_xxx
export RI_CONFIG='{"projectName":"test","baseUrl":"https://example.com","issueRepo":"your/repo","pages":[{"name":"首页","url":"/"}]}'
bun run packages/runner/bin/react-scan-cli.ts
```
