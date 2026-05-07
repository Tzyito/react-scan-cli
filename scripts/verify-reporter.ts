#!/usr/bin/env bun
// Verify reporter: check issue body content and optionally write real GitHub Issues
// Usage:
//   bun run scripts/verify-reporter.ts          # dry-run (no GitHub API calls)
//   GITHUB_TOKEN=xxx ISSUE_REPO=owner/repo bun run scripts/verify-reporter.ts --real
import { GitHubReporter } from '../packages/runner/src/reporter';
import type { PageReport } from '../packages/runner/src/types';

const mockReport: PageReport = {
  page: 'Home',
  url: '/zh-CN/topics',
  issues: [
    { component: 'UserList', count: 68, reasons: ['props:data', 'props:onSelect', 'context:ThemeContext'], severity: 'high' },
    { component: 'Header', count: 31, reasons: ['state:isScrolled'], severity: 'medium' },
    { component: 'Avatar', count: 12, reasons: ['props:src'], severity: 'low' },
  ],
  // 1×1 transparent PNG
  screenshotBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  observeDuration: 8000,
  timestamp: new Date().toISOString(),
};

const isReal = process.argv.includes('--real');

async function dryRun() {
  class InspectableReporter extends GitHubReporter {
    inspect(report: PageReport, projectName: string) {
      return (this as any).buildIssueBody(report, projectName);
    }
  }

  const reporter = new InspectableReporter('dry-run-token', 'owner/repo');
  const body = reporter.inspect(mockReport, 'test-project');

  console.log('=== generated issue body ===\n');
  console.log(body);

  const checks: [string, boolean][] = [
    ['contains page-url comment (dedup key)', body.includes('<!-- page-url: /zh-CN/topics -->')],
    ['contains project comment', body.includes('<!-- project: test-project -->')],
    ['lists UserList component', body.includes('UserList')],
    ['includes severity icon', body.includes('🔴')],
    ['embeds screenshot img tag', body.includes('<img src="data:image/png;base64,')],
    ['has props suggestion', body.includes('useMemo')],
    ['has context suggestion', body.includes('context value')],
    ['has state suggestion', body.includes('throttle') || body.includes('Throttle')],
    ['has reproduction steps', body.includes('document.cookie')],
  ];

  console.log('\n=== checks ===');
  let pass = true;
  for (const [label, result] of checks) {
    console.log(`${result ? '✓' : '✗'} ${label}`);
    if (!result) pass = false;
  }

  if (pass) {
    console.log('\n✅ reporter dry-run passed');
    console.log('   to write a real Issue: GITHUB_TOKEN=xxx ISSUE_REPO=owner/repo bun run scripts/verify-reporter.ts --real');
  } else {
    console.log('\n❌ reporter verification failed');
    process.exit(1);
  }
}

async function realRun() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.ISSUE_REPO;

  if (!token || !repo) {
    console.error('missing env: GITHUB_TOKEN and ISSUE_REPO (format: owner/repo)');
    process.exit(1);
  }

  console.log(`[verify] real mode: writing to ${repo}`);
  const reporter = new GitHubReporter(token, repo);

  console.log('[verify] scenario 1: issues found → create Issue');
  await reporter.report([mockReport], 'verify-test');
  console.log('✓ done — check: https://github.com/' + repo + '/issues');

  console.log('\n[verify] scenario 2: no issues → auto-close Issue');
  await reporter.report([{ ...mockReport, issues: [] }], 'verify-test');
  console.log('✓ done — Issue should now be closed');
}

if (isReal) {
  realRun().catch(err => { console.error(err); process.exit(1); });
} else {
  dryRun().catch(err => { console.error(err); process.exit(1); });
}
