import type { PageReport } from './types';
import { buildIssueBody } from './issue-body';

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
    const description = buildIssueBody(report, projectName);
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

}
