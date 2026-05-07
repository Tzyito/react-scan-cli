import { Octokit } from '@octokit/rest';
import type { PageReport } from './types';
import { buildIssueBody, buildIssueTitle, buildDiffComment, parseSnapshot } from './issue-body';

const LABEL_BASE = 'react-scan-cli';

const CATEGORY_LABELS: Record<string, { color: string; description: string }> = {
  '重渲染':     { color: 'f97316', description: 'React re-render performance issue' },
  '代码报错':   { color: 'dc2626', description: 'Uncaught JavaScript exception' },
  '接口报错':   { color: '7c3aed', description: 'Same-origin API returned 4xx/5xx' },
  '登录失败':   { color: 'db2777', description: 'Authentication flow failed' },
  '数据展示不全': { color: 'b45309', description: 'UI assertion failed — expected data not shown' },
  'severity:high':   { color: 'dc2626', description: '' },
  'severity:medium': { color: 'f59e0b', description: '' },
  'severity:low':    { color: '22c55e', description: '' },
};

function hasAnyIssue(report: PageReport): boolean {
  return (
    report.issues.length > 0 ||
    report.jsErrors.length > 0 ||
    report.apiErrors.length > 0 ||
    report.assertionFailures.length > 0 ||
    report.authFailure != null
  );
}

function getLabels(report: PageReport, projectName: string): string[] {
  const labels = [LABEL_BASE, projectName];

  if (report.issues.length > 0) {
    labels.push('重渲染');
    const severity = report.issues[0]?.severity ?? 'low';
    labels.push(`severity:${severity}`);
  }
  if (report.jsErrors.length > 0)          labels.push('代码报错');
  if (report.apiErrors.length > 0)         labels.push('接口报错');
  if (report.authFailure)                  labels.push('登录失败');
  if (report.assertionFailures.length > 0) labels.push('数据展示不全');

  return labels;
}

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
      if (hasAnyIssue(report)) {
        await this.upsertIssue(report, projectName);
      } else {
        await this.closeResolvedIssue(report, projectName);
      }
    }
  }

  private async ensureLabels(projectName: string): Promise<void> {
    const all = [
      { name: LABEL_BASE, color: 'e11d48', description: 'Detected by react-scan-cli' },
      { name: projectName, color: '6366f1', description: '' },
      ...Object.entries(CATEGORY_LABELS).map(([name, meta]) => ({ name, ...meta })),
    ];
    for (const label of all) {
      try {
        await this.octokit.issues.createLabel({ owner: this.owner, repo: this.repo, ...label });
      } catch {
        // label already exists
      }
    }
  }

  private async upsertIssue(report: PageReport, projectName: string): Promise<void> {
    const existing = await this.findOpenIssue(projectName, report.url);
    const title = buildIssueTitle(report, projectName);
    const body = buildIssueBody(report, projectName);
    const labels = getLabels(report, projectName);

    if (existing) {
      const prevSnapshot = parseSnapshot(existing.body);
      await this.octokit.issues.update({
        owner: this.owner, repo: this.repo,
        issue_number: existing.number, title, body, labels,
      });
      await this.octokit.issues.createComment({
        owner: this.owner, repo: this.repo,
        issue_number: existing.number,
        body: buildDiffComment(report, prevSnapshot),
      });
    } else {
      const newIssue = await this.octokit.issues.create({
        owner: this.owner, repo: this.repo, title, body, labels,
      });
      await this.octokit.issues.createComment({
        owner: this.owner, repo: this.repo,
        issue_number: newIssue.data.number,
        body: buildDiffComment(report, null),
      });
    }
  }

  private async closeResolvedIssue(report: PageReport, projectName: string): Promise<void> {
    const existing = await this.findOpenIssue(projectName, report.url);
    if (!existing) return;

    await this.octokit.issues.createComment({
      owner: this.owner, repo: this.repo,
      issue_number: existing.number,
      body: `✅ **Auto-closed** · ${new Date().toUTCString()}\n\nNo issues detected in the latest scan.`,
    });
    await this.octokit.issues.update({
      owner: this.owner, repo: this.repo,
      issue_number: existing.number, state: 'closed',
    });
  }

  private async findOpenIssue(projectName: string, pageUrl: string) {
    const { data } = await this.octokit.issues.listForRepo({
      owner: this.owner, repo: this.repo,
      state: 'open', labels: `${LABEL_BASE},${projectName}`, per_page: 100,
    });
    return data.find(issue => issue.body?.includes(`<!-- page-url: ${pageUrl} -->`)) ?? null;
  }
}
