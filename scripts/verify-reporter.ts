#!/usr/bin/env bun
// 验证 reporter 生成的 issue body 和 dry-run 调用 GitHub API
// 用法：
//   dry-run（不真实调用 GitHub）：bun run scripts/verify-reporter.ts
//   真实创建 Issue：GITHUB_TOKEN=xxx ISSUE_REPO=owner/repo bun run scripts/verify-reporter.ts --real
import { GitHubReporter } from '../packages/runner/src/reporter';
import type { PageReport } from '../packages/runner/src/types';

const mockReport: PageReport = {
  page: '社区首页',
  url: '/zh-CN/topics',
  issues: [
    {
      component: 'UserList',
      count: 68,
      reasons: ['props:data', 'props:onSelect', 'context:ThemeContext'],
      severity: 'high',
    },
    {
      component: 'Header',
      count: 31,
      reasons: ['state:isScrolled'],
      severity: 'medium',
    },
    {
      component: 'Avatar',
      count: 12,
      reasons: ['props:src'],
      severity: 'low',
    },
  ],
  screenshotBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  observeDuration: 8000,
  timestamp: new Date().toISOString(),
};

const isReal = process.argv.includes('--real');

async function dryRun() {
  // 用 private method 暴露来检查 body 生成
  // 通过子类 hack 访问 private buildIssueBody
  class InspectableReporter extends GitHubReporter {
    inspect(report: PageReport, projectName: string) {
      return (this as any).buildIssueBody(report, projectName);
    }
  }

  const reporter = new InspectableReporter('dry-run-token', 'owner/repo');
  const body = reporter.inspect(mockReport, 'test-project');

  console.log('=== 生成的 Issue Body ===\n');
  console.log(body);

  const checks: [string, boolean][] = [
    ['包含 page-url 注释（用于去重）', body.includes('<!-- page-url: /zh-CN/topics -->')],
    ['包含 project 注释', body.includes('<!-- project: test-project -->')],
    ['包含 UserList 组件', body.includes('UserList')],
    ['包含 severity 图标', body.includes('🔴')],
    ['包含截图 img 标签', body.includes('<img src="data:image/png;base64,')],
    ['包含优化建议（props）', body.includes('useMemo')],
    ['包含优化建议（context）', body.includes('Context')],
    ['包含优化建议（state）', body.includes('throttle')],
    ['包含复现方式', body.includes('document.cookie')],
  ];

  console.log('\n=== 检查项 ===');
  let pass = true;
  for (const [label, result] of checks) {
    const icon = result ? '✓' : '✗';
    console.log(`${icon} ${label}`);
    if (!result) pass = false;
  }

  if (pass) {
    console.log('\n✅ Reporter dry-run 验证通过');
    console.log('   如需真实创建 Issue，运行：');
    console.log('   GITHUB_TOKEN=xxx ISSUE_REPO=owner/repo bun run scripts/verify-reporter.ts --real');
  } else {
    console.log('\n❌ Reporter 验证失败');
    process.exit(1);
  }
}

async function realRun() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.ISSUE_REPO;

  if (!token || !repo) {
    console.error('缺少环境变量：GITHUB_TOKEN 和 ISSUE_REPO（格式 owner/repo）');
    process.exit(1);
  }

  console.log(`[verify] 真实模式：写入 ${repo}`);
  const reporter = new GitHubReporter(token, repo);

  console.log('[verify] 场景 1：有问题 → 创建 Issue');
  await reporter.report([mockReport], 'verify-test');
  console.log('✓ 场景 1 完成，请检查：https://github.com/' + repo + '/issues');

  console.log('\n[verify] 场景 2：问题消失 → 自动关闭 Issue');
  await reporter.report([{ ...mockReport, issues: [] }], 'verify-test');
  console.log('✓ 场景 2 完成，Issue 应已被自动关闭');
}

if (isReal) {
  realRun().catch(err => { console.error(err); process.exit(1); });
} else {
  dryRun().catch(err => { console.error(err); process.exit(1); });
}
