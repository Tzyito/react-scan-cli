import { chromium, type BrowserContext } from 'playwright';
import type { RunnerConfig, PageReport, ComponentData, IssueData } from './types';

export async function analyzePages(config: RunnerConfig): Promise<PageReport[]> {
  const {
    baseUrl,
    pages,
    triggerCookie = '__render_inspector__',
    observeDuration = 8000,
    threshold = 5,
    authSetup,
  } = config;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const domain = new URL(baseUrl).hostname;
  await context.addCookies([{
    name: triggerCookie,
    value: 'true',
    domain,
    path: '/',
  }]);

  if (authSetup) {
    const page = await context.newPage();
    await authSetup(page);
    await page.close();
  }

  const reports: PageReport[] = [];

  for (const pageConfig of pages) {
    console.log(`[react-scan-cli] 正在分析：${pageConfig.name} (${pageConfig.url})`);
    try {
      const report = await analyzeSinglePage(context, baseUrl, pageConfig, observeDuration, threshold);
      reports.push(report);
      console.log(`[react-scan-cli] ✓ ${pageConfig.name}: ${report.issues.length} 个问题`);
    } catch (err) {
      console.error(`[react-scan-cli] ✗ ${pageConfig.name} 分析失败:`, err);
    }
  }

  await browser.close();
  return reports;
}

async function analyzeSinglePage(
  context: BrowserContext,
  baseUrl: string,
  pageConfig: { name: string; url: string },
  observeDuration: number,
  threshold: number,
): Promise<PageReport> {
  const page = await context.newPage();

  // 捕获页面 console，方便排查注入脚本的错误
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error(`  [page error] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    console.error(`  [page uncaught] ${err.message}`);
  });

  await page.goto(baseUrl + pageConfig.url, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  await page.waitForTimeout(observeDuration);

  // 诊断：打印注入脚本的运行状态
  const debugState = await page.evaluate(() => ({
    hasInspector: '__renderInspector__' in window,
    inspector: (window as any).__renderInspector__ ?? null,
    cookies: document.cookie,
  }));
  console.log(`  [debug] hasInspector=${debugState.hasInspector} cookies="${debugState.cookies}"`);
  if (debugState.inspector) {
    const compCount = Object.keys(debugState.inspector.components).length;
    console.log(`  [debug] components tracked: ${compCount}`, compCount > 0 ? debugState.inspector.components : '(empty)');
  }

  const rawComponents = await page.evaluate(() => {
    return (window as any).__renderInspector__?.components ?? {};
  }) as Record<string, ComponentData>;

  const screenshotBuffer = await page.screenshot({ fullPage: false });
  const screenshotBase64 = screenshotBuffer.toString('base64');

  await page.close();

  const issues: IssueData[] = Object.entries(rawComponents)
    .filter(([, data]) => data.count > threshold)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([component, data]) => ({
      component,
      count: data.count,
      reasons: data.reasons,
      severity: data.count > 50 ? 'high' : data.count > 20 ? 'medium' : 'low',
    }));

  return {
    page: pageConfig.name,
    url: pageConfig.url,
    issues,
    screenshotBase64,
    observeDuration,
    timestamp: new Date().toISOString(),
  };
}
