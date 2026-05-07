import { Octokit } from '@octokit/rest';
import type { PageReport } from './types';
import { buildIssueBody } from './issue-body';

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
    const body = buildIssueBody(report, projectName);
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

}
