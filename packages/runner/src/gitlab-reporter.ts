import type { PageReport } from './types';

const ISSUE_LABEL = 'react-scan-cli';
const SEVERITY_LABELS = {
  high: 'severity::high',
  medium: 'severity::medium',
  low: 'severity::low',
};

interface GitLabIssue {
  iid: number;
  title: string;
  description: string;
  labels: string[];
  state: string;
  web_url: string;
}

export class GitLabReporter {
  private baseUrl: string;
  private token: string;
  private projectId: string;

  constructor(token: string, project: string, baseUrl = 'https://gitlab.com') {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.projectId = encodeURIComponent(project);
  }

  private get api() {
    return `${this.baseUrl}/api/v4/projects/${this.projectId}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.api}${path}`, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitLab API ${method} ${path} → ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
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
      { name: ISSUE_LABEL, color: '#e11d48', description: 'React re-render issue detected by react-scan-cli' },
      { name: projectName, color: '#6366f1', description: '' },
      { name: 'severity::high', color: '#dc2626', description: '' },
      { name: 'severity::medium', color: '#f59e0b', description: '' },
      { name: 'severity::low', color: '#22c55e', description: '' },
    ];
    for (const label of labels) {
      try {
        await this.request('POST', '/labels', label);
      } catch {
        // label already exists
      }
    }
  }

  private async upsertIssue(report: PageReport, projectName: string): Promise<void> {
    const existing = await this.findOpenIssue(projectName, report.url);
    const highestSeverity = report.issues[0]?.severity ?? 'low';

    const title = `[${projectName}] ${report.page} · ${report.issues.length} re-render issue(s)`;
    const description = this.buildIssueBody(report, projectName);
    const labels = [ISSUE_LABEL, projectName, SEVERITY_LABELS[highestSeverity]].join(',');

    if (existing) {
      await this.request('PUT', `/issues/${existing.iid}`, { title, description, labels });
      await this.request('POST', `/issues/${existing.iid}/notes`, {
        body: `🔄 **Auto-updated** · ${new Date().toUTCString()}\n\nIssue still present — data refreshed from latest scan.`,
      });
    } else {
      await this.request('POST', '/issues', { title, description, labels });
    }
  }

  private async closeResolvedIssue(report: PageReport, projectName: string): Promise<void> {
    const existing = await this.findOpenIssue(projectName, report.url);
    if (!existing) return;

    await this.request('POST', `/issues/${existing.iid}/notes`, {
      body: `✅ **Auto-closed** · ${new Date().toUTCString()}\n\nNo re-render issues detected in the latest scan.`,
    });
    await this.request('PUT', `/issues/${existing.iid}`, { state_event: 'close' });
  }

  private async findOpenIssue(projectName: string, pageUrl: string): Promise<GitLabIssue | null> {
    const issues = await this.request<GitLabIssue[]>(
      'GET',
      `/issues?labels=${encodeURIComponent(`${ISSUE_LABEL},${projectName}`)}&state=opened&per_page=100`,
    );
    return issues.find(issue => issue.description?.includes(`<!-- page-url: ${pageUrl} -->`)) ?? null;
  }

  private buildIssueBody(report: PageReport, projectName: string): string {
    const icon = { high: '🔴', medium: '🟡', low: '🟢' };
    const severityLabel = { high: 'High', medium: 'Medium', low: 'Low' };

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
| **${issue.count}** | ${severityLabel[issue.severity]} | ${issue.reasons.join(', ') || 'unknown'} |

**Suggestions**

${this.getSuggestion(issue.reasons)}
`).join('\n---\n')}

## Screenshot

<img src="data:image/png;base64,${report.screenshotBase64}" width="800" alt="page screenshot" />

## Reproduction

1. Visit \`${report.url}\`
2. Wait for the page to fully load (~${report.observeDuration / 1000}s)
3. Open React DevTools → Profiler → record, watch the components listed above

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
