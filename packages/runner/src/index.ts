import { analyzePages } from './analyzer';
import { GitHubReporter } from './reporter';
import type { RunnerConfig } from './types';

export async function run(config: RunnerConfig): Promise<void> {
  console.log(`[react-scan-cli] project: ${config.projectName}`);
  console.log(`[react-scan-cli] target:  ${config.baseUrl}`);
  console.log(`[react-scan-cli] pages:   ${config.pages.length}`);
  console.log('');

  const reports = await analyzePages(config);

  const reporter = new GitHubReporter(config.githubToken, config.issueRepo);
  await reporter.report(reports, config.projectName);

  const totalIssues = reports.reduce((sum, r) => sum + r.issues.length, 0);
  const highCount = reports.flatMap(r => r.issues).filter(i => i.severity === 'high').length;

  console.log('');
  console.log('[react-scan-cli] done');
  console.log(`[react-scan-cli] issues found: ${totalIssues} (high: ${highCount})`);
  console.log(`[react-scan-cli] report: https://github.com/${config.issueRepo}/issues`);
}

export type { RunnerConfig, PageConfig } from './types';
