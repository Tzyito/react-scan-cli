#!/usr/bin/env bun
// End-to-end test: start playground dev server → collect data → print report
// Usage:
//   bun run e2e                                          # print results only
//   GITHUB_TOKEN=xxx ISSUE_REPO=owner/repo bun run e2e  # also write GitHub Issues
import { analyzePages } from '../packages/runner/src/analyzer';
import { GitHubReporter } from '../packages/runner/src/reporter';
import { join } from 'path';

const BASE_URL = 'http://localhost:5173';
const PLAYGROUND_DIR = join(import.meta.dir, '../playground');

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status < 500) return;
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error(`dev server did not start within ${timeoutMs}ms`);
}

async function main() {
  console.log('[e2e] starting playground dev server...');
  const server = Bun.spawn(['bun', 'run', 'dev'], {
    cwd: PLAYGROUND_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  try {
    await waitForServer(BASE_URL);
    console.log(`[e2e] server ready: ${BASE_URL}\n`);

    const reports = await analyzePages({
      projectName: 'playground',
      baseUrl: BASE_URL,
      issueRepo: 'placeholder/placeholder',
      githubToken: 'placeholder',
      pages: [{ name: 'Home', url: '/' }],
      observeDuration: 6000,
      threshold: 5,
    });

    console.log('\n=== results ===');
    for (const report of reports) {
      if (report.issues.length === 0) {
        console.log(`✅ ${report.page}: no issues`);
        continue;
      }
      console.log(`⚠️  ${report.page}: ${report.issues.length} issue(s)`);
      for (const issue of report.issues) {
        const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
        console.log(`  ${icon} ${issue.component}  ×${issue.count}  [${issue.severity}]`);
        console.log(`     triggers: ${issue.reasons.join(', ') || 'unknown'}`);
      }
    }

    const issues = reports.flatMap(r => r.issues);
    const checks: [string, boolean][] = [
      ['UserList re-render detected', issues.some(i => i.component === 'UserList')],
      ['Header re-render detected', issues.some(i => i.component === 'Header')],
      ['UserList flagged as high (>50)', issues.some(i => i.component === 'UserList' && i.severity === 'high')],
    ];

    console.log('\n=== assertions ===');
    let pass = true;
    for (const [label, result] of checks) {
      console.log(`${result ? '✓' : '✗'} ${label}`);
      if (!result) pass = false;
    }

    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.ISSUE_REPO;
    if (token && repo) {
      console.log(`\n[e2e] writing GitHub Issues → ${repo}`);
      const reporter = new GitHubReporter(token, repo);
      await reporter.report(reports, 'playground');
      console.log(`✅ https://github.com/${repo}/issues`);
    } else {
      console.log('\nhint: set GITHUB_TOKEN + ISSUE_REPO to also write Issues');
    }

    if (!pass) process.exit(1);
    console.log('\n✅ e2e passed');
  } finally {
    server.kill();
    console.log('[e2e] dev server stopped');
  }
}

main().catch(err => {
  console.error('[e2e] fatal:', err);
  process.exit(1);
});
