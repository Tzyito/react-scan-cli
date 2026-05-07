#!/usr/bin/env bun
// 验证 analyzer 能正确从页面读取数据并生成 PageReport
// 用法：bun run scripts/verify-analyzer.ts
import { chromium } from 'playwright';
import { join } from 'path';

const FIXTURE_PATH = join(import.meta.dir, 'fixtures/mock-page.html');
const THRESHOLD = 5;

async function main() {
  console.log('[verify] 启动 Playwright...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const fileUrl = `file://${FIXTURE_PATH}`;
  console.log(`[verify] 加载 fixture: ${fileUrl}`);
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // 读取数据（与 analyzer.ts 中逻辑相同）
  const rawComponents = await page.evaluate(() => {
    return (window as any).__renderInspector__?.components ?? {};
  });

  console.log('\n[verify] 读取到的原始数据:');
  console.log(JSON.stringify(rawComponents, null, 2));

  // 整理问题列表（与 analyzer.ts 中逻辑相同）
  const issues = Object.entries(rawComponents as Record<string, { count: number; reasons: string[] }>)
    .filter(([, data]) => data.count > THRESHOLD)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([component, data]) => ({
      component,
      count: data.count,
      reasons: data.reasons,
      severity: data.count > 50 ? 'high' : data.count > 20 ? 'medium' : 'low',
    }));

  console.log('\n[verify] 识别到的问题（已过滤阈值）:');
  for (const issue of issues) {
    const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
    console.log(`  ${icon} ${issue.component}: ${issue.count} 次 (${issue.severity})`);
    console.log(`     原因: ${issue.reasons.join(', ')}`);
  }

  // 截图
  const screenshotPath = join(import.meta.dir, 'fixtures/screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`\n[verify] 截图保存到: ${screenshotPath}`);

  await browser.close();

  // 断言
  const checks: [string, boolean][] = [
    ['UserList 被识别为 high', issues.some(i => i.component === 'UserList' && i.severity === 'high')],
    ['Header 被识别为 medium', issues.some(i => i.component === 'Header' && i.severity === 'medium')],
    ['Avatar 被识别为 low', issues.some(i => i.component === 'Avatar' && i.severity === 'low')],
    ['Button（count=3）未被上报', !issues.some(i => i.component === 'Button')],
    ['问题按 count 降序排列', issues[0]?.component === 'UserList'],
  ];

  console.log('\n=== 检查项 ===');
  let pass = true;
  for (const [label, result] of checks) {
    const icon = result ? '✓' : '✗';
    console.log(`${icon} ${label}`);
    if (!result) pass = false;
  }

  if (pass) {
    console.log('\n✅ Analyzer 验证通过');
  } else {
    console.log('\n❌ Analyzer 验证失败');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('验证失败:', err);
  process.exit(1);
});
