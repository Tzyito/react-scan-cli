import { analyzePages } from './analyzer';
import { GitHubReporter } from './reporter';
import { GitLabReporter } from './gitlab-reporter';
import type { RunnerConfig } from './types';

function createReporter(config: RunnerConfig) {
  const provider = config.provider ?? 'github';

  if (provider === 'gitlab') {
    if (!config.gitlabToken) throw new Error('[react-scan-cli] gitlabToken is required for GitLab provider');
    if (!config.gitlabProject) throw new Error('[react-scan-cli] gitlabProject is required for GitLab provider');
    return new GitLabReporter(config.gitlabToken, config.gitlabProject, config.gitlabBaseUrl);
  }

  if (!config.githubToken) throw new Error('[react-scan-cli] githubToken is required for GitHub provider');
  if (!config.issueRepo) throw new Error('[react-scan-cli] issueRepo is required for GitHub provider');
  return new GitHubReporter(config.githubToken, config.issueRepo);
}

function issueTrackerUrl(config: RunnerConfig): string {
  if ((config.provider ?? 'github') === 'gitlab') {
    const base = (config.gitlabBaseUrl ?? 'https://gitlab.com').replace(/\/$/, '');
    return `${base}/${config.gitlabProject}/-/issues`;
  }
  return `https://github.com/${config.issueRepo}/issues`;
}

export async function run(config: RunnerConfig): Promise<void> {
  console.log(`[react-scan-cli] project:  ${config.projectName}`);
  console.log(`[react-scan-cli] target:   ${config.baseUrl}`);
  console.log(`[react-scan-cli] provider: ${config.provider ?? 'github'}`);
  console.log('');

  const reports = await analyzePages(config);

  const reporter = createReporter(config);
  await reporter.report(reports, config.projectName);

  const totalIssues = reports.reduce((sum, r) => sum + r.issues.length, 0);
  const highCount = reports.flatMap(r => r.issues).filter(i => i.severity === 'high').length;

  console.log('');
  console.log('[react-scan-cli] done');
  console.log(`[react-scan-cli] pages scanned: ${reports.length}`);
  console.log(`[react-scan-cli] issues found:  ${totalIssues} (high: ${highCount})`);
  console.log(`[react-scan-cli] issues at:     ${issueTrackerUrl(config)}`);
}

export type { RunnerConfig, PageConfig, ReporterProvider } from './types';
