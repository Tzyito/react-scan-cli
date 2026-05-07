#!/usr/bin/env bun
// Verify that the analyzer correctly reads window.__renderInspector__ from a page
// Usage: bun run scripts/verify-analyzer.ts
import { chromium } from 'playwright';
import { join } from 'path';

const FIXTURE_PATH = join(import.meta.dir, 'fixtures/mock-page.html');
const THRESHOLD = 5;

async function main() {
  console.log('[verify] launching Playwright...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const fileUrl = `file://${FIXTURE_PATH}`;
  console.log(`[verify] loading fixture: ${fileUrl}`);
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  const rawComponents = await page.evaluate(() => {
    return (window as any).__renderInspector__?.components ?? {};
  });

  console.log('\n[verify] raw data from page:');
  console.log(JSON.stringify(rawComponents, null, 2));

  const issues = Object.entries(rawComponents as Record<string, { count: number; reasons: string[] }>)
    .filter(([, data]) => data.count > THRESHOLD)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([component, data]) => ({
      component,
      count: data.count,
      reasons: data.reasons,
      severity: data.count > 50 ? 'high' : data.count > 20 ? 'medium' : 'low',
    }));

  console.log('\n[verify] issues above threshold:');
  for (const issue of issues) {
    const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
    console.log(`  ${icon} ${issue.component}: ${issue.count} (${issue.severity})`);
    console.log(`     triggers: ${issue.reasons.join(', ')}`);
  }

  const screenshotPath = join(import.meta.dir, 'fixtures/screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`\n[verify] screenshot saved: ${screenshotPath}`);

  await browser.close();

  const checks: [string, boolean][] = [
    ['UserList flagged as high', issues.some(i => i.component === 'UserList' && i.severity === 'high')],
    ['Header flagged as medium', issues.some(i => i.component === 'Header' && i.severity === 'medium')],
    ['Avatar flagged as low', issues.some(i => i.component === 'Avatar' && i.severity === 'low')],
    ['Button (count=3) not reported', !issues.some(i => i.component === 'Button')],
    ['sorted by count descending', issues[0]?.component === 'UserList'],
  ];

  console.log('\n=== checks ===');
  let pass = true;
  for (const [label, result] of checks) {
    console.log(`${result ? '✓' : '✗'} ${label}`);
    if (!result) pass = false;
  }

  if (pass) {
    console.log('\n✅ analyzer verified');
  } else {
    console.log('\n❌ analyzer verification failed');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('verification failed:', err);
  process.exit(1);
});
