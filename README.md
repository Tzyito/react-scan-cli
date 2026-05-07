# react-scan-cli

自动检测 React 页面重渲染问题，结果写入 GitHub Issues，支持定时巡检和手动触发。

## 特性

- 只需装一个 Vite 插件 + 复制一个 GitHub Actions 模板，20 分钟完成接入
- 通过 cookie 触发，不影响普通用户
- 检测结果自动写到指定 GitHub 仓库的 Issues
- 同一页面同一问题不重复创建 Issue，问题消失时自动关闭
- 完全基于 GitHub Actions，不需要额外服务器

## 快速接入

### 1. 安装 Vite 插件

```bash
bun add -d @react-scan-cli/vite-plugin
```

```ts
// vite.config.ts
import { renderInspector } from '@react-scan-cli/vite-plugin';

export default {
  plugins: [
    renderInspector({
      threshold: 5,      // 重渲染次数超过此值才上报，默认 5
      enableInDev: true, // 开发环境自动开启，默认 true
    }),
  ],
};
```

### 2. AI 引导接入（推荐）

```bash
npx @react-scan-cli/skills
```

在 Claude Code 里运行 `/react-scan-cli`，AI 会引导你完成所有配置步骤。

### 3. 建接收 Issue 的 GitHub 仓库

新建一个空仓库，例如 `your-org/perf-issues`，不需要任何配置。

### 4. 配置 GitHub Secrets

进入项目仓库 → Settings → Secrets → Actions，添加：

**`REACT_SCAN_TOKEN`**

GitHub Fine-grained Personal Access Token，需要目标仓库的 Issues 读写权限。

**`REACT_SCAN_CONFIG`**

JSON 格式的配置：

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

### 5. 复制 workflow 文件

把 `workflow-template/render-check.yml` 复制到项目的 `.github/workflows/render-check.yml`。

完成。下周一凌晨会自动跑第一次，也可以到 Actions 页面手动触发。

---

## 工作原理

```
用户项目安装 @react-scan-cli/vite-plugin
  └── vite.config.ts 加一行即可

GitHub Actions 定时触发（每周一凌晨）
  └── 安装 @react-scan-cli/runner
  └── 启动 Playwright 无头浏览器
  └── 注入 cookie __render_inspector__=true
  └── 访问每个页面，等待 observeDuration 毫秒
  └── 读取 window.__renderInspector__ 数据
  └── 截图保存为 base64（写到 Issue body）

写 GitHub Issues
  └── 有问题 → 找同项目同页面的 open issue
      ├── 存在 → 更新 body + 加评论
      └── 不存在 → 创建新 issue
  └── 无问题 → 自动关闭已有 open issue
```

---

## 配置项

### vite-plugin 配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `triggerCookie` | `string` | `'__render_inspector__'` | 触发检测的 cookie 名称 |
| `threshold` | `number` | `5` | 重渲染次数阈值 |
| `enableInDev` | `boolean` | `true` | 开发环境是否自动开启 |

### REACT_SCAN_CONFIG 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `projectName` | `string` | ✓ | 项目名称，用于 issue 标题和 label |
| `baseUrl` | `string` | ✓ | 目标站点根地址 |
| `issueRepo` | `string` | ✓ | 接收 issue 的仓库，格式 `owner/repo` |
| `pages` | `PageConfig[]` | ✓ | 要检测的页面列表 |
| `observeDuration` | `number` | — | 每个页面观察多少毫秒，默认 `8000` |
| `threshold` | `number` | — | 超过多少次渲染算问题，默认 `5` |

---

## 私有页面登录

```ts
import { run } from '@react-scan-cli/runner';

await run({
  projectName: 'my-project',
  baseUrl: 'https://example.com',
  issueRepo: 'your-org/perf-issues',
  githubToken: process.env.GITHUB_TOKEN!,
  pages: [{ name: '个人中心', url: '/profile' }],
  authSetup: async (page) => {
    await page.goto('https://example.com/login');
    await page.fill('#email', 'test@example.com');
    await page.fill('#password', 'password');
    await page.click('[type=submit]');
    await page.waitForURL('**/dashboard');
  },
});
```

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

---

## Packages

| 包 | 说明 |
|---|---|
| `@react-scan-cli/vite-plugin` | Vite 插件，注入检测脚本 |
| `@react-scan-cli/runner` | CLI 工具，Playwright 采集 + GitHub Issues 写入 |
| `@react-scan-cli/skills` | Claude Code skill，AI 引导接入 |
