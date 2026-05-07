#!/usr/bin/env bun
// 端到端验证：启动 playground dev server → 采集数据 → 打印报告
// 用法：
//   bun run e2e                                               # 只打印结果
//   GITHUB_TOKEN=xxx ISSUE_REPO=owner/repo bun run e2e       # 同时写 GitHub Issues
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
  throw new Error(`dev server 未在 ${timeoutMs}ms 内就绪`);
}

async function main() {
  console.log('[e2e] 启动 playground dev server...');
  // inherit 把 vite 日志直接打出来，方便排查启动失败
  const server = Bun.spawn(['bun', 'run', 'dev'], {
    cwd: PLAYGROUND_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  try {
    await waitForServer(BASE_URL);
    console.log(`[e2e] dev server 已就绪: ${BASE_URL}\n`);

    const reports = await analyzePages({
      projectName: 'playground',
      baseUrl: BASE_URL,
      issueRepo: 'placeholder/placeholder',
      githubToken: 'placeholder',
      pages: [{ name: '首页', url: '/' }],
      observeDuration: 6000,   // 6s × 10次/s = ~60 次重渲染，高于阈值
      threshold: 5,
    });

    console.log('\n=== 采集结果 ===');
    for (const report of reports) {
      if (report.issues.length === 0) {
        console.log(`✅ ${report.page}: 未发现重渲染问题`);
        continue;
      }
      console.log(`⚠️  ${report.page}: 发现 ${report.issues.length} 个问题`);
      for (const issue of report.issues) {
        const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
        console.log(`  ${icon} ${issue.component}`);
        console.log(`     重渲染次数: ${issue.count}  严重程度: ${issue.severity}`);
        console.log(`     触发原因: ${issue.reasons.join(', ') || '未知'}`);
      }
    }

    // 验证预期结果
    const issues = reports.flatMap(r => r.issues);
    const checks: [string, boolean][] = [
      ['检测到 UserList 重渲染问题', issues.some(i => i.component === 'UserList')],
      ['检测到 Header 重渲染问题', issues.some(i => i.component === 'Header')],
      ['UserList 被标记为 high (>50次)', issues.some(i => i.component === 'UserList' && i.severity === 'high')],
    ];

    console.log('\n=== 断言检查 ===');
    let pass = true;
    for (const [label, result] of checks) {
      console.log(`${result ? '✓' : '✗'} ${label}`);
      if (!result) pass = false;
    }

    // 可选：真实写 GitHub Issues
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.ISSUE_REPO;
    if (token && repo) {
      console.log(`\n[e2e] 写入 GitHub Issues → ${repo}`);
      const reporter = new GitHubReporter(token, repo);
      await reporter.report(reports, 'playground');
      console.log(`✅ https://github.com/${repo}/issues`);
    } else {
      console.log('\n提示：设置 GITHUB_TOKEN + ISSUE_REPO 环境变量可真实写 Issues');
    }

    if (!pass) process.exit(1);
    console.log('\n✅ E2E 验证通过');
  } finally {
    server.kill();
    console.log('[e2e] dev server 已关闭');
  }
}

main().catch(err => {
  console.error('[e2e] 失败:', err);
  process.exit(1);
});
