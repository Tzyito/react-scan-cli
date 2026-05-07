import { Octokit } from '@octokit/rest';
import type { PageReport, IssueData } from './types';

const ISSUE_LABEL = 'react-scan-cli';
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
      { name: ISSUE_LABEL, color: 'e11d48', description: 'React re-render issue detected by react-scan-cli' },
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
        // label already exists, ignore
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
// 方法 1：通过 cookie 开启 react-scan 高亮（需要项目已接入 @react-scan-cli/vite-plugin）
document.cookie = '__render_inspector__=true; path=/';
location.reload();

// 方法 2：React DevTools Profiler
// DevTools → Profiler → 勾选 "Record why each component rendered" → 录制
\`\`\`

---
*由 [react-scan-cli](https://github.com/Tzyito/react-scan-cli) 自动生成 · 修复后请关闭此 Issue*`.trim();
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
