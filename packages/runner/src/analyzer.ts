import { chromium, type BrowserContext, type Page } from 'playwright';
import type { RunnerConfig, PageReport, ComponentData, IssueData, PageInteraction } from './types';
import { crawlPages } from './crawler';

export async function analyzePages(config: RunnerConfig): Promise<PageReport[]> {
  const {
    baseUrl,
    triggerCookie = '__render_inspector__',
    observeDuration = 8000,
    threshold = 5,
    maxPages = 20,
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

  let pages = config.pages;
  if (!pages || pages.length === 0) {
    console.log(`[react-scan-cli] no pages specified — crawling ${baseUrl} (max ${maxPages})`);
    pages = await crawlPages(context, baseUrl, maxPages);
    console.log(`[react-scan-cli] discovered ${pages.length} page(s): ${pages.map(p => p.name).join(', ')}`);
  }

  const reports: PageReport[] = [];

  for (const pageConfig of pages) {
    const displayUrl = pageConfig.url.startsWith('http') ? pageConfig.url : baseUrl + pageConfig.url;
    console.log(`[react-scan-cli] analyzing: ${pageConfig.name} → ${displayUrl}`);
    try {
      const report = await analyzeSinglePage(context, baseUrl, pageConfig, observeDuration, threshold);
      reports.push(report);
      console.log(`[react-scan-cli] ✓ ${pageConfig.name}: ${report.issues.length} issue(s)`);
    } catch (err) {
      console.error(`[react-scan-cli] ✗ ${pageConfig.name} failed:`, err);
    }
  }

  await browser.close();
  return reports;
}

async function analyzeSinglePage(
  context: BrowserContext,
  baseUrl: string,
  pageConfig: { name: string; url: string; interactions?: PageInteraction[] },
  observeDuration: number,
  threshold: number,
): Promise<PageReport> {
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`  [page error] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.error(`  [page uncaught] ${err.message}`);
  });

  const startTime = Date.now();

  const targetUrl = pageConfig.url.startsWith('http')
    ? pageConfig.url
    : baseUrl + pageConfig.url;

  await page.goto(targetUrl, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Let the page settle before interactions
  await page.waitForTimeout(800);

  // Run interactions during the observation window
  await runInteractions(page, pageConfig.interactions);

  // Fill remaining observation time
  const elapsed = Date.now() - startTime;
  const remaining = observeDuration - elapsed;
  if (remaining > 0) await page.waitForTimeout(remaining);

  const debugState = await page.evaluate(() => ({
    hasInspector: '__renderInspector__' in window,
    inspector: (window as any).__renderInspector__ ?? null,
    cookies: document.cookie,
  }));
  console.log(`  [debug] hasInspector=${debugState.hasInspector} cookies="${debugState.cookies}"`);
  if (debugState.inspector) {
    const count = Object.keys(debugState.inspector.components).length;
    console.log(`  [debug] components tracked: ${count}`);
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
    .map(([component, data]) => {
      const avgTime = data.totalTime > 0 && data.count > 0
        ? Math.round((data.totalTime / data.count) * 10) / 10
        : null;
      return {
        component,
        count: data.count,
        unnecessaryCount: data.unnecessaryCount ?? 0,
        avgTime,
        minFps: data.minFps ?? null,
        reasons: data.reasons,
        changes: data.changes ?? [],
        severity: calcSeverity(data.count, avgTime, data.minFps),
      };
    });

  return {
    page: pageConfig.name,
    url: pageConfig.url,
    issues,
    screenshotBase64,
    observeDuration,
    timestamp: new Date().toISOString(),
  };
}

function calcSeverity(
  count: number,
  avgTime: number | null,
  minFps: number | null,
): 'high' | 'medium' | 'low' {
  const slowRender = avgTime != null && avgTime > 16;
  const fpsDrop = minFps != null && minFps < 30;
  if (count > 50 || (count > 20 && slowRender) || fpsDrop) return 'high';
  if (count > 20 || (count > 10 && slowRender) || (minFps != null && minFps < 60)) return 'medium';
  return 'low';
}

const DEFAULT_INTERACTIONS: PageInteraction[] = [
  { type: 'scroll', scrollY: 0.25, description: 'scroll 25%' },
  { type: 'wait', waitMs: 400 },
  { type: 'scroll', scrollY: 0.5, description: 'scroll 50%' },
  { type: 'wait', waitMs: 400 },
  { type: 'scroll', scrollY: 0.75, description: 'scroll 75%' },
  { type: 'wait', waitMs: 400 },
  { type: 'scroll', scrollY: 1.0, description: 'scroll to bottom' },
  { type: 'wait', waitMs: 600 },
  { type: 'scroll', scrollY: 0, description: 'scroll back to top' },
  { type: 'wait', waitMs: 400 },
];

async function runInteractions(page: Page, custom?: PageInteraction[]): Promise<void> {
  const all = [...DEFAULT_INTERACTIONS, ...(custom ?? [])];

  for (const action of all) {
    try {
      if (action.description) {
        console.log(`  [interact] ${action.description}`);
      }

      switch (action.type) {
        case 'scroll': {
          const y = action.scrollY ?? 0;
          if (y <= 1) {
            await page.evaluate((pct: number) =>
              window.scrollTo({ top: document.body.scrollHeight * pct, behavior: 'smooth' }),
              y,
            );
          } else {
            await page.evaluate((px: number) =>
              window.scrollTo({ top: px, behavior: 'smooth' }),
              y,
            );
          }
          break;
        }
        case 'click': {
          if (action.selector) {
            const el = page.locator(action.selector).first();
            await el.click({ timeout: 3000 });
          }
          break;
        }
        case 'hover': {
          if (action.selector) {
            const el = page.locator(action.selector).first();
            await el.hover({ timeout: 3000 });
          }
          break;
        }
        case 'fill': {
          if (action.selector && action.value != null) {
            const el = page.locator(action.selector).first();
            await el.fill(action.value, { timeout: 3000 });
          }
          break;
        }
        case 'waitForSelector': {
          if (action.selector) {
            await page.waitForSelector(action.selector, {
              timeout: action.waitMs ?? 5000,
            });
          }
          break;
        }
        case 'wait': {
          await page.waitForTimeout(action.waitMs ?? 500);
          break;
        }
      }
    } catch (err) {
      // Non-fatal: log and continue
      console.warn(`  [interact] skipped (${action.type} ${action.selector ?? ''}): ${(err as Error).message}`);
    }
  }
}
