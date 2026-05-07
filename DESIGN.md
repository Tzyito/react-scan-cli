# vite-plugin-render-inspector — 设计文档

> 自动检测 React 页面重渲染问题，结果写入 GitHub Issues，支持定时巡检和手动触发。

---

## 目标

- 用户只需装一个 Vite 插件 + 复制一个 GitHub Actions 模板，20 分钟完成接入
- 通过 cookie 触发，不影响普通用户
- 检测结果自动写到指定 GitHub 仓库的 Issues，修复后手动关闭
- 同一页面同一问题不重复创建 Issue，问题消失时自动关闭
- 完全基于 GitHub Actions，不需要额外服务器

---

## 仓库结构

```
vite-plugin-render-inspector/
├── packages/
│   ├── vite-plugin/               # 给用户项目安装的 Vite 插件
│   │   ├── src/
│   │   │   ├── index.ts           # 插件入口，transformIndexHtml 注入脚本
│   │   │   ├── inject.ts          # 注入到浏览器运行的检测代码（字符串模板）
│   │   │   └── types.ts           # 插件配置类型
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── runner/                    # CLI 工具，在 GitHub Actions 里跑
│   │   ├── src/
│   │   │   ├── index.ts           # CLI 入口，parse config，串联流程
│   │   │   ├── analyzer.ts        # Playwright 采集页面数据
│   │   │   ├── reporter.ts        # 写 GitHub Issues
│   │   │   └── types.ts           # 共享类型定义
│   │   ├── bin/
│   │   │   └── render-inspector.ts  # CLI 入口，bun 直接执行 ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/
│       └── types.ts               # packages 之间共享的类型
│
├── workflow-template/
│   └── render-check.yml           # 用户复制到自己项目的 Actions 模板
│
├── bunfig.toml                    # bun 配置
├── package.json                   # 根 package.json，workspaces 配置
└── README.md
```

---

## 包名和发布

```
@render-inspector/vite-plugin     # vite 插件
@render-inspector/runner          # CLI 工具
```

CLI 命令：`render-inspector run`

---

## 核心流程

```
1. 用户项目安装 @render-inspector/vite-plugin
   └── vite.config.ts 加一行即可

2. GitHub Actions 定时触发（每周一凌晨）
   └── 安装 @render-inspector/runner
   └── npx playwright install chromium
   └── render-inspector run

3. Runner 读取配置（来自环境变量 RI_CONFIG）
   └── 启动 Playwright 无头浏览器
   └── 注入 cookie __render_inspector__=true
   └── 访问每个页面，等待 observeDuration 毫秒
   └── 读取 window.__renderInspector__ 数据
   └── 截图保存为 base64（写到 Issue body 里，不需要外部存储）

4. 写 GitHub Issues
   └── 有问题 → 找同项目同页面的 open issue
       ├── 存在 → 更新 body + 加评论说明是新一轮检测
       └── 不存在 → 创建新 issue
   └── 无问题 → 找同项目同页面的 open issue → 自动关闭并加评论

5. 结果：接收仓库的 Issues 里可以看到所有问题
```

---

## vite-plugin 实现

### 插件配置类型

```ts
// packages/vite-plugin/src/types.ts
export interface RenderInspectorOptions {
  triggerCookie?: string;    // 默认 '__render_inspector__'
  threshold?: number;        // 重渲染次数阈值，默认 5
  enableInDev?: boolean;     // 开发环境是否自动开启，默认 true
}
```

### 插件入口

```ts
// packages/vite-plugin/src/index.ts
import type { Plugin } from 'vite';
import type { RenderInspectorOptions } from './types';
import { buildInjectScript } from './inject';

export function renderInspector(options: RenderInspectorOptions = {}): Plugin {
  const config = {
    triggerCookie: '__render_inspector__',
    threshold: 5,
    enableInDev: true,
    ...options,
  };

  return {
    name: 'vite-plugin-render-inspector',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: buildInjectScript(config),
          injectTo: 'head',
        },
      ];
    },
  };
}

export type { RenderInspectorOptions };
```

### 注入到浏览器的脚本

```ts
// packages/vite-plugin/src/inject.ts
// 注意：这段代码会被字符串化后注入到用户页面，不能引用外部模块
export function buildInjectScript(opts: {
  triggerCookie: string;
  threshold: number;
  enableInDev: boolean;
}): string {
  return `
import { scan } from 'react-scan';

(function() {
  const isDev = import.meta.env.DEV;
  const hasCookie = document.cookie
    .split(';')
    .some(c => c.trim() === '${opts.triggerCookie}=true');

  if (!hasCookie && !(isDev && ${opts.enableInDev})) return;

  // 挂载数据容器，供 runner 通过 page.evaluate() 读取
  window.__renderInspector__ = {
    version: '1.0.0',
    page: location.pathname,
    startTime: Date.now(),
    threshold: ${opts.threshold},
    components: {},
  };

  scan({
    enabled: true,
    showToolbar: isDev && !hasCookie,  // 只在开发环境手动开时显示工具栏
    log: false,
    onRender(fiber, renders) {
      const name =
        fiber.type?.displayName ||
        fiber.type?.name ||
        null;

      // 过滤匿名组件和 React 内部组件
      if (!name || name.startsWith('_') || name === 'Anonymous') return;

      const data = window.__renderInspector__.components;
      if (!data[name]) {
        data[name] = { count: 0, reasons: [] };
      }

      data[name].count += renders.length;

      renders.forEach(r => {
        r.changes?.forEach(change => {
          const reason = change.type + ':' + change.name;
          if (!data[name].reasons.includes(reason)) {
            data[name].reasons.push(reason);
          }
        });
      });
    },
  });
})();
  `.trim();
}
```

### package.json

```json
{
  "name": "@render-inspector/vite-plugin",
  "version": "0.1.0",
  "description": "Vite plugin to detect React re-render issues",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target node --format esm && bun build src/index.ts --outdir dist --target node --format cjs --outfile dist/index.js",
    "dev": "bun build src/index.ts --outdir dist --target node --format esm --watch",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react-scan": ">=0.1.0",
    "vite": ">=4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@types/bun": "latest"
  }
}
```

---

## runner 实现

### 类型定义

```ts
// packages/runner/src/types.ts

export interface PageConfig {
  name: string;   // 页面展示名称，如 "社区首页"
  url: string;    // 路径，如 "/zh-CN/topics"
}

export interface RunnerConfig {
  projectName: string;       // 项目名称，如 "longbridge-web"
  baseUrl: string;           // 目标站点根地址，如 "https://longbridge.com"
  issueRepo: string;         // 接收 issue 的仓库，格式 "owner/repo"
  githubToken: string;       // GitHub Personal Access Token
  pages: PageConfig[];       // 要检测的页面列表
  triggerCookie?: string;    // 默认 '__render_inspector__'
  observeDuration?: number;  // 每个页面观察多少毫秒，默认 8000
  threshold?: number;        // 超过多少次渲染算问题，默认 5
  authSetup?: (page: import('playwright').Page) => Promise<void>;  // 可选登录逻辑
}

export interface ComponentData {
  count: number;
  reasons: string[];
}

export interface IssueData {
  component: string;
  count: number;
  reasons: string[];
  severity: 'high' | 'medium' | 'low';  // high: >50, medium: >20, low: >5
}

export interface PageReport {
  page: string;
  url: string;
  issues: IssueData[];
  screenshotBase64: string;   // 截图直接存在 issue body，不需要外部存储
  observeDuration: number;
  timestamp: string;
}
```

### analyzer.ts

```ts
// packages/runner/src/analyzer.ts
import { chromium, Page, BrowserContext } from 'playwright';
import type { RunnerConfig, PageReport, ComponentData, IssueData } from './types';

export async function analyzePages(config: RunnerConfig): Promise<PageReport[]> {
  const {
    baseUrl,
    pages,
    triggerCookie = '__render_inspector__',
    observeDuration = 8000,
    threshold = 5,
    authSetup,
  } = config;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // 注入触发 cookie
  const domain = new URL(baseUrl).hostname;
  await context.addCookies([{
    name: triggerCookie,
    value: 'true',
    domain,
    path: '/',
  }]);

  // 执行登录（如果需要）
  if (authSetup) {
    const page = await context.newPage();
    await authSetup(page);
    await page.close();
  }

  const reports: PageReport[] = [];

  for (const pageConfig of pages) {
    console.log(`[render-inspector] 正在分析：${pageConfig.name} (${pageConfig.url})`);
    try {
      const report = await analyzeSinglePage(
        context,
        baseUrl,
        pageConfig,
        observeDuration,
        threshold,
      );
      reports.push(report);
      console.log(`[render-inspector] ✓ ${pageConfig.name}: ${report.issues.length} 个问题`);
    } catch (err) {
      console.error(`[render-inspector] ✗ ${pageConfig.name} 分析失败:`, err);
    }
  }

  await browser.close();
  return reports;
}

async function analyzeSinglePage(
  context: BrowserContext,
  baseUrl: string,
  pageConfig: { name: string; url: string },
  observeDuration: number,
  threshold: number,
): Promise<PageReport> {
  const page = await context.newPage();

  await page.goto(baseUrl + pageConfig.url, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // 等待页面稳定后开始观察
  await page.waitForTimeout(observeDuration);

  // 读取检测数据
  const rawComponents = await page.evaluate(() => {
    return (window as any).__renderInspector__?.components ?? {};
  }) as Record<string, ComponentData>;

  // 截图（base64，写入 issue body）
  const screenshotBuffer = await page.screenshot({ fullPage: false });
  const screenshotBase64 = screenshotBuffer.toString('base64');

  await page.close();

  // 整理问题列表
  const issues: IssueData[] = Object.entries(rawComponents)
    .filter(([_, data]) => data.count > threshold)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([component, data]) => ({
      component,
      count: data.count,
      reasons: data.reasons,
      severity: data.count > 50 ? 'high' : data.count > 20 ? 'medium' : 'low',
    }));

  return {
    page: pageConfig.name,
    url: pageConfig.url,
    issues,
    screenshotBase64,
    observeDuration,
    timestamp: new Date().toISOString(),
  };
}
```

### reporter.ts

```ts
// packages/runner/src/reporter.ts
import { Octokit } from '@octokit/rest';
import type { PageReport, IssueData } from './types';

const ISSUE_LABEL = 'render-inspector';
const SEVERITY_LABELS = {
  high: 'severity:high',
  medium: 'severity:medium',
  low: 'severity:low',
};

export class GitHubReporter {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, repoFullName: string) {
    this.octokit = new Octokit({ auth: token });
    const [owner, repo] = repoFullName.split('/');
    this.owner = owner;
    this.repo = repo;
  }

  async report(reports: PageReport[], projectName: string): Promise<void> {
    // 确保所需 label 都存在
    await this.ensureLabels(projectName);

    for (const report of reports) {
      if (report.issues.length > 0) {
        await this.upsertIssue(report, projectName);
      } else {
        await this.closeResolvedIssue(report, projectName);
      }
    }
  }

  private async ensureLabels(projectName: string): Promise<void> {
    const labelsToCreate = [
      { name: ISSUE_LABEL, color: 'e11d48', description: 'React re-render issue detected by render-inspector' },
      { name: projectName, color: '6366f1', description: '' },
      { name: 'severity:high', color: 'dc2626', description: '' },
      { name: 'severity:medium', color: 'f59e0b', description: '' },
      { name: 'severity:low', color: '22c55e', description: '' },
    ];

    for (const label of labelsToCreate) {
      try {
        await this.octokit.issues.createLabel({
          owner: this.owner,
          repo: this.repo,
          ...label,
        });
      } catch {
        // label 已存在，忽略
      }
    }
  }

  private async upsertIssue(report: PageReport, projectName: string): Promise<void> {
    const existing = await this.findOpenIssue(projectName, report.url);
    const highestSeverity = report.issues[0]?.severity ?? 'low';

    const title = `[${projectName}] ${report.page} · ${report.issues.length} 个重渲染问题`;
    const body = this.buildIssueBody(report, projectName);
    const labels = [ISSUE_LABEL, projectName, SEVERITY_LABELS[highestSeverity]];

    if (existing) {
      // 更新已有 issue
      await this.octokit.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: existing.number,
        title,
        body,
        labels,
      });
      await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: existing.number,
        body: `🔄 **自动更新** · ${new Date().toLocaleString('zh-CN')}\n\n问题仍然存在，数据已更新为最新检测结果。`,
      });
    } else {
      // 创建新 issue
      await this.octokit.issues.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        labels,
      });
    }
  }

  private async closeResolvedIssue(report: PageReport, projectName: string): Promise<void> {
    const existing = await this.findOpenIssue(projectName, report.url);
    if (!existing) return;

    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: existing.number,
      body: `✅ **自动关闭** · ${new Date().toLocaleString('zh-CN')}\n\n本次检测未发现重渲染问题，自动关闭此 Issue。`,
    });
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: existing.number,
      state: 'closed',
    });
  }

  private async findOpenIssue(projectName: string, pageUrl: string) {
    const { data } = await this.octokit.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      state: 'open',
      labels: `${ISSUE_LABEL},${projectName}`,
      per_page: 100,
    });
    // 通过 URL 匹配找到对应页面的 issue
    return data.find(issue =>
      issue.body?.includes(`<!-- page-url: ${pageUrl} -->`)
    ) ?? null;
  }

  private buildIssueBody(report: PageReport, projectName: string): string {
    const severityIcon = { high: '🔴', medium: '🟡', low: '🟢' };
    const severityText = { high: '严重', medium: '中等', low: '轻微' };

    return `<!-- page-url: ${report.url} -->
<!-- project: ${projectName} -->

## 页面信息

| 项目 | 页面 | URL | 检测时间 | 观察时长 |
|------|------|-----|----------|----------|
| \`${projectName}\` | ${report.page} | \`${report.url}\` | ${new Date(report.timestamp).toLocaleString('zh-CN')} | ${report.observeDuration / 1000}s |

## 问题组件

${report.issues.map((issue, idx) => `
### ${idx + 1}. ${severityIcon[issue.severity]} \`${issue.component}\`

| 重渲染次数 | 严重程度 | 触发原因 |
|-----------|---------|---------|
| **${issue.count}** 次 | ${severityText[issue.severity]} | ${issue.reasons.join(', ') || '未知'} |

**优化建议**

${this.getSuggestion(issue.reasons)}
`).join('\n---\n')}

## 页面截图

<img src="data:image/png;base64,${report.screenshotBase64}" width="800" alt="页面截图" />

## 复现方式

1. 访问 \`${report.url}\`
2. 等待页面完全加载（约 ${report.observeDuration / 1000} 秒）
3. 安装 React DevTools，打开 Profiler 面板录制，观察以上组件的重渲染情况

## 快速定位

在浏览器 Console 运行以下代码，实时查看重渲染组件：

\`\`\`js
// 方法 1：通过 cookie 开启 react-scan 高亮（需要项目已接入 vite-plugin-render-inspector）
document.cookie = '__render_inspector__=true; path=/';
location.reload();

// 方法 2：React DevTools Profiler
// DevTools → Profiler → 勾选 "Record why each component rendered" → 录制
\`\`\`

---
*由 [vite-plugin-render-inspector](https://github.com/your-org/vite-plugin-render-inspector) 自动生成 · 修复后请关闭此 Issue*`.trim();
  }

  private getSuggestion(reasons: string[]): string {
    const lines: string[] = [];

    if (reasons.some(r => r.startsWith('props'))) {
      lines.push(
        '- 父组件传入了非稳定引用（对象字面量、内联箭头函数），每次渲染都产生新引用',
        '- 使用 `useMemo` 稳定对象/数组，使用 `useCallback` 稳定函数',
        '- 使用 `React.memo()` 包裹组件，让 props 浅比较生效',
      );
    }

    if (reasons.some(r => r.startsWith('context'))) {
      lines.push(
        '- Context value 是对象且未 memo，每次父组件渲染都创建新对象触发所有消费者',
        '- 用 `useMemo` 稳定 Context 的 value：`const value = useMemo(() => ({ ... }), [deps])`',
        '- 考虑将大 Context 拆分为多个粒度更小的 Context',
      );
    }

    if (reasons.some(r => r.startsWith('state'))) {
      lines.push(
        '- 检查是否有 WebSocket 推送或定时器在高频调用 setState',
        '- 用 `throttle` 或 `debounce` 限制更新频率（建议不低于 200ms）',
        '- 用 `useReducer` 合并多个 state 的批量更新',
      );
    }

    if (lines.length === 0) {
      lines.push(
        '- 打开 React DevTools Profiler，勾选 "Record why each component rendered" 后录制',
        '- 查看 "Why did this render?" 面板获取详细原因',
      );
    }

    return lines.join('\n');
  }
}
```

### CLI 入口

```ts
// packages/runner/src/index.ts
import { analyzePages } from './analyzer';
import { GitHubReporter } from './reporter';
import type { RunnerConfig } from './types';

export async function run(config: RunnerConfig): Promise<void> {
  console.log(`[render-inspector] 开始检测项目：${config.projectName}`);
  console.log(`[render-inspector] 目标站点：${config.baseUrl}`);
  console.log(`[render-inspector] 页面数量：${config.pages.length}`);
  console.log('');

  const reports = await analyzePages(config);

  const reporter = new GitHubReporter(config.githubToken, config.issueRepo);
  await reporter.report(reports, config.projectName);

  const totalIssues = reports.reduce((sum, r) => sum + r.issues.length, 0);
  const highCount = reports.flatMap(r => r.issues).filter(i => i.severity === 'high').length;

  console.log('');
  console.log('[render-inspector] 检测完成');
  console.log(`[render-inspector] 发现问题：${totalIssues} 个（高危：${highCount} 个）`);
  console.log(`[render-inspector] 查看报告：https://github.com/${config.issueRepo}/issues`);
}

export type { RunnerConfig, PageConfig } from './types';
```

```ts
// packages/runner/src/cli.ts — CLI 解析入口
import { run } from './index';
import type { RunnerConfig } from './types';

async function main() {
  // 配置从环境变量读取（GitHub Secrets 传入）
  const githubToken = process.env.GITHUB_TOKEN;
  const rawConfig = process.env.RI_CONFIG;

  if (!githubToken) {
    console.error('[render-inspector] 错误：缺少 GITHUB_TOKEN 环境变量');
    process.exit(1);
  }

  if (!rawConfig) {
    console.error('[render-inspector] 错误：缺少 RI_CONFIG 环境变量');
    process.exit(1);
  }

  let config: Omit<RunnerConfig, 'githubToken'>;
  try {
    config = JSON.parse(rawConfig);
  } catch {
    console.error('[render-inspector] 错误：RI_CONFIG 不是合法的 JSON');
    process.exit(1);
  }

  await run({ ...config, githubToken });
}

main().catch(err => {
  console.error('[render-inspector] 运行失败：', err);
  process.exit(1);
});
```

```ts
// packages/runner/bin/render-inspector.ts
#!/usr/bin/env bun
// bun 原生支持直接执行 TypeScript，不需要编译
import '../src/cli';
```

### package.json

```json
{
  "name": "@render-inspector/runner",
  "version": "0.1.0",
  "description": "CLI runner for render-inspector, collects data via Playwright and reports to GitHub Issues",
  "bin": {
    "render-inspector": "./bin/render-inspector.ts"
  },
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "dev": "bun run src/cli.ts",
    "build": "bun build src/index.ts --outdir dist --target node --format esm && bun build src/cli.ts --outfile dist/cli.js --target node --format cjs",
    "typecheck": "tsc --noEmit",
    "start": "bun run bin/render-inspector.ts"
  },
  "dependencies": {
    "@octokit/rest": "^20.0.0",
    "playwright": "^1.40.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/bun": "latest"
  }
}
```

---

## GitHub Actions 模板

```yaml
# workflow-template/render-check.yml
# 复制到你的项目: .github/workflows/render-check.yml

name: React 重渲染检测

on:
  schedule:
    - cron: '0 2 * * 1'   # 每周一凌晨 2 点（UTC）
  workflow_dispatch:        # 支持手动触发

jobs:
  render-check:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: 安装 Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: 安装 runner
        run: bun install -g @render-inspector/runner

      - name: 安装 Playwright Chromium
        run: bunx playwright install chromium --with-deps

      - name: 运行检测
        run: render-inspector run
        env:
          GITHUB_TOKEN: ${{ secrets.RENDER_INSPECTOR_TOKEN }}
          RI_CONFIG: ${{ secrets.RENDER_INSPECTOR_CONFIG }}
```

---

## 用户配置（存入 GitHub Secrets）

### RENDER_INSPECTOR_TOKEN

GitHub Personal Access Token，需要以下权限：
- `repo` — 对接收 issue 的仓库有写权限

### RENDER_INSPECTOR_CONFIG

JSON 格式的配置，示例：

```json
{
  "projectName": "my-project",
  "baseUrl": "https://example.com",
  "issueRepo": "your-org/perf-issues",
  "observeDuration": 8000,
  "threshold": 5,
  "pages": [
    { "name": "首页", "url": "/" },
    { "name": "社区", "url": "/zh-CN/topics" },
    { "name": "发现", "url": "/zh-CN/discover" }
  ]
}
```

---

## 用户接入步骤

### 1. 安装 Vite 插件

```bash
bun add -d @render-inspector/vite-plugin
```

```ts
// vite.config.ts
import { renderInspector } from '@render-inspector/vite-plugin';

export default {
  plugins: [
    renderInspector({
      threshold: 5,
      enableInDev: true,
    }),
  ],
};
```

确保 `react-scan` 也已安装：

```bash
bun add -d react-scan
```

### 2. 建接收 Issue 的 GitHub 仓库

新建一个空仓库，例如 `your-org/perf-issues`，不需要任何配置。

### 3. 在用户项目里配置 Secrets

进入项目仓库 → Settings → Secrets → Actions，添加：

- `RENDER_INSPECTOR_TOKEN`：GitHub PAT（有目标仓库 repo 权限）
- `RENDER_INSPECTOR_CONFIG`：上面的 JSON 配置

### 4. 复制 workflow 文件

把 `workflow-template/render-check.yml` 复制到项目的 `.github/workflows/render-check.yml`。

完成，下周一凌晨会自动跑第一次。也可以到 Actions 页面手动触发。

---

## 本地开发调试

```bash
# 克隆仓库
git clone https://github.com/your-org/vite-plugin-render-inspector
cd vite-plugin-render-inspector

# 安装依赖（bun workspaces 自动处理所有包）
bun install

# 构建所有包
bun run build

# 本地测试 runner（需要先 export 环境变量）
export GITHUB_TOKEN=ghp_xxx
export RI_CONFIG='{"projectName":"test","baseUrl":"https://example.com","issueRepo":"your/repo","pages":[{"name":"首页","url":"/"}]}'

# bun 直接执行 ts，不需要编译
bun run packages/runner/bin/render-inspector.ts run
```

---

## bunfig.toml

```toml
# bun workspaces 配置在根 package.json 的 workspaces 字段
# bunfig.toml 用于配置 bun 行为
[install]
# 安装时自动处理 workspace 包的链接
exact = false

[run]
# bun run 时的默认行为
bun = true
```

---

## 根目录 package.json

```json
{
  "name": "vite-plugin-render-inspector",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "bun run --filter '*' build",
    "dev": "bun run --filter '*' dev",
    "typecheck": "bun run --filter '*' typecheck",
    "lint": "eslint packages/*/src/**/*.ts"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "eslint": "^8.0.0",
    "@types/bun": "latest"
  }
}
```

---

## GitHub Issues 效果示例

接收仓库里自动出现：

```
🔴 [longbridge-web] 社区首页 · 3 个重渲染问题   labels: render-inspector, longbridge-web, severity:high
🟡 [longbridge-web] 发现页 · 1 个重渲染问题     labels: render-inspector, longbridge-web, severity:medium
✅ [longbridge-web] 资讯页                       (自动关闭，问题已解决)
```

每个 Issue 包含：
- 问题组件列表，按渲染次数排序
- 每个组件的触发原因和优化建议
- 页面截图（base64 内嵌，不需要图床）
- 复现方式和快速定位代码
- 隐藏 HTML 注释用于匹配去重（`<!-- page-url: /zh-CN/topics -->`）

---

## 注意事项

1. **截图大小**：base64 图片会让 issue body 变大，建议 `fullPage: false` 只截可视区域
2. **私有页面**：通过 `authSetup` 回调注入登录态，cookie 或 localStorage 均可
3. **SPA 路由**：`waitUntil: 'networkidle'` 等待数据加载完成，可根据实际情况调整
4. **react-scan 版本**：需要 `>=0.1.0`，`onRender` 回调的 `changes` 字段在不同版本可能有差异，注意兼容
5. **GitHub API 限速**：PAT 每小时 5000 次请求，正常使用不会触发
6. **Issue 去重**：通过 body 里的隐藏注释 `<!-- page-url: ... -->` 匹配，不依赖 title，避免 title 改动后重复创建