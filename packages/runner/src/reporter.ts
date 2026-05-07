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
    const labels = [
      { name: ISSUE_LABEL, color: 'e11d48', description: 'React re-render issue detected by react-scan-cli' },
      { name: projectName, color: '6366f1', description: '' },
      { name: 'severity:high', color: 'dc2626', description: '' },
      { name: 'severity:medium', color: 'f59e0b', description: '' },
      { name: 'severity:low', color: '22c55e', description: '' },
    ];
    for (const label of labels) {
      try {
        await this.octokit.issues.createLabel({ owner: this.owner, repo: this.repo, ...label });
      } catch {
        // label already exists
      }
    }
  }

  private async upsertIssue(report: PageReport, projectName: string): Promise<void> {
    const existing = await this.findOpenIssue(projectName, report.url);
    const highestSeverity = report.issues[0]?.severity ?? 'low';

    const title = `[${projectName}] ${report.page} · ${report.issues.length} re-render issue(s)`;
    const body = this.buildIssueBody(report, projectName);
    const labels = [ISSUE_LABEL, projectName, SEVERITY_LABELS[highestSeverity]];

    if (existing) {
      await this.octokit.issues.update({
        owner: this.owner, repo: this.repo,
        issue_number: existing.number, title, body, labels,
      });
      await this.octokit.issues.createComment({
        owner: this.owner, repo: this.repo,
        issue_number: existing.number,
        body: `🔄 **Auto-updated** · ${new Date().toUTCString()}\n\nIssue still present — data refreshed from latest scan.`,
      });
    } else {
      await this.octokit.issues.create({
        owner: this.owner, repo: this.repo, title, body, labels,
      });
    }
  }

  private async closeResolvedIssue(report: PageReport, projectName: string): Promise<void> {
    const existing = await this.findOpenIssue(projectName, report.url);
    if (!existing) return;

    await this.octokit.issues.createComment({
      owner: this.owner, repo: this.repo,
      issue_number: existing.number,
      body: `✅ **Auto-closed** · ${new Date().toUTCString()}\n\nNo re-render issues detected in the latest scan.`,
    });
    await this.octokit.issues.update({
      owner: this.owner, repo: this.repo,
      issue_number: existing.number, state: 'closed',
    });
  }

  private async findOpenIssue(projectName: string, pageUrl: string) {
    const { data } = await this.octokit.issues.listForRepo({
      owner: this.owner, repo: this.repo,
      state: 'open', labels: `${ISSUE_LABEL},${projectName}`, per_page: 100,
    });
    // match by hidden comment so title changes don't create duplicates
    return data.find(issue => issue.body?.includes(`<!-- page-url: ${pageUrl} -->`)) ?? null;
  }

  private buildIssueBody(report: PageReport, projectName: string): string {
    const icon = { high: '🔴', medium: '🟡', low: '🟢' };
    const severity = { high: 'High', medium: 'Medium', low: 'Low' };

    return `<!-- page-url: ${report.url} -->
<!-- project: ${projectName} -->

## Page Info

| Project | Page | URL | Detected at | Observe duration |
|---------|------|-----|-------------|-----------------|
| \`${projectName}\` | ${report.page} | \`${report.url}\` | ${new Date(report.timestamp).toUTCString()} | ${report.observeDuration / 1000}s |

## Problematic Components

${report.issues.map((issue, idx) => `
### ${idx + 1}. ${icon[issue.severity]} \`${issue.component}\`

| Re-renders | Severity | Triggers |
|-----------|----------|---------|
| **${issue.count}** | ${severity[issue.severity]} | ${issue.reasons.join(', ') || 'unknown'} |

**Suggestions**

${this.getSuggestion(issue.reasons)}
`).join('\n---\n')}

## Screenshot

<img src="data:image/png;base64,${report.screenshotBase64}" width="800" alt="page screenshot" />

## Reproduction

1. Visit \`${report.url}\`
2. Wait for the page to fully load (~${report.observeDuration / 1000}s)
3. Open React DevTools → Profiler → record, watch the components listed above

## Quick Diagnosis

Run in the browser console to enable react-scan highlights:

\`\`\`js
// Option 1: enable via cookie (requires @react-scan-cli/vite-plugin)
document.cookie = '__render_inspector__=true; path=/';
location.reload();

// Option 2: React DevTools Profiler
// DevTools → Profiler → check "Record why each component rendered" → record
\`\`\`

---
*Generated by [react-scan-cli](https://github.com/Tzyito/react-scan-cli) · Close this issue once fixed*`.trim();
  }

  private getSuggestion(reasons: string[]): string {
    const lines: string[] = [];

    if (reasons.some(r => r.startsWith('props'))) {
      lines.push(
        '- Parent passes unstable references (inline objects/arrays or arrow functions) on every render',
        '- Stabilize with `useMemo` for objects/arrays, `useCallback` for functions',
        '- Wrap the component with `React.memo()` to enable shallow prop comparison',
      );
    }

    if (reasons.some(r => r.startsWith('context'))) {
      lines.push(
        '- Context value is an un-memoized object — every parent render creates a new reference',
        '- Memoize: `const value = useMemo(() => ({ ... }), [deps])`',
        '- Consider splitting large contexts into smaller, more focused ones',
      );
    }

    if (reasons.some(r => r.startsWith('state'))) {
      lines.push(
        '- Check for high-frequency `setState` from WebSocket messages or timers',
        '- Throttle or debounce updates (recommended interval: ≥200ms)',
        '- Batch multiple state updates with `useReducer`',
      );
    }

    if (lines.length === 0) {
      lines.push(
        '- Open React DevTools Profiler, enable "Record why each component rendered", then record',
        '- Check the "Why did this render?" panel for details',
      );
    }

    return lines.join('\n');
  }
}
