import { analyzePages } from './analyzer';
import { GitHubReporter } from './reporter';
import type { RunnerConfig } from './types';

export async function run(config: RunnerConfig): Promise<void> {
  console.log(`[react-scan-cli] 开始检测项目：${config.projectName}`);
  console.log(`[react-scan-cli] 目标站点：${config.baseUrl}`);
  console.log(`[react-scan-cli] 页面数量：${config.pages.length}`);
  console.log('');

  const reports = await analyzePages(config);

  const reporter = new GitHubReporter(config.githubToken, config.issueRepo);
  await reporter.report(reports, config.projectName);

  const totalIssues = reports.reduce((sum, r) => sum + r.issues.length, 0);
  const highCount = reports.flatMap(r => r.issues).filter(i => i.severity === 'high').length;

  console.log('');
  console.log('[react-scan-cli] 检测完成');
  console.log(`[react-scan-cli] 发现问题：${totalIssues} 个（高危：${highCount} 个）`);
  console.log(`[react-scan-cli] 查看报告：https://github.com/${config.issueRepo}/issues`);
}

export type { RunnerConfig, PageConfig } from './types';
