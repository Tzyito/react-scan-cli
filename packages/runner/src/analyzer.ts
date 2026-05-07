import { chromium, type BrowserContext, type Page } from 'playwright';
import type {
  RunnerConfig, PageReport, ComponentData, IssueData,
  PageInteraction, Assertion, AssertionResult, JsError, ApiError,
} from './types';
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

  let globalAuthFailure: string | null = null;
  if (authSetup) {
    const page = await context.newPage();
    try {
      await authSetup(page);
    } catch (err) {
      globalAuthFailure = (err as Error).message;
      console.error(`[react-scan-cli] ✗ authSetup failed: ${globalAuthFailure}`);
    }
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
      const report = await analyzeSinglePage(
        context, baseUrl, pageConfig, observeDuration, threshold, globalAuthFailure,
      );
      reports.push(report);
      const categories = summarizeCategories(report);
      console.log(`[react-scan-cli] ✓ ${pageConfig.name}: ${categories || 'no issues'}`);
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
  pageConfig: { name: string; url: string; interactions?: PageInteraction[]; assertions?: import('./types').Assertion[] },
  observeDuration: number,
  threshold: number,
  authFailure: string | null,
): Promise<PageReport> {
  const page = await context.newPage();

  const jsErrors: JsError[] = [];
  const apiErrors: ApiError[] = [];
  const baseHostname = new URL(baseUrl).hostname;

  page.on('pageerror', (err) => {
    console.error(`  [js-error] ${err.message}`);
    jsErrors.push({
      message: err.message,
      stack: err.stack ?? '',
      components: extractReactComponents(err.stack ?? ''),
    });
  });

  page.on('response', (response) => {
    if (response.status() < 400) return;
    try {
      const responseHostname = new URL(response.url()).hostname;
      if (responseHostname !== baseHostname) return;
    } catch {
      return;
    }
    apiErrors.push({
      url: response.url(),
      status: response.status(),
      method: response.request().method(),
    });
    console.warn(`  [api-error] ${response.request().method()} ${response.url()} → ${response.status()}`);
  });

  const startTime = Date.now();

  const targetUrl = pageConfig.url.startsWith('http')
    ? pageConfig.url
    : baseUrl + pageConfig.url;

  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);

  await runInteractions(page, pageConfig.interactions);

  const elapsed = Date.now() - startTime;
  const remaining = observeDuration - elapsed;
  if (remaining > 0) await page.waitForTimeout(remaining);

  const assertionFailures = await runAssertions(page, pageConfig.assertions ?? []);

  const debugState = await page.evaluate(() => ({
    hasInspector: '__renderInspector__' in window,
    inspector: (window as any).__renderInspector__ ?? null,
    cookies: document.cookie,
  }));
  console.log(`  [debug] hasInspector=${debugState.hasInspector} cookies="${debugState.cookies}"`);
  if (debugState.inspector) {
    console.log(`  [debug] components tracked: ${Object.keys(debugState.inspector.components).length}`);
  }

  const rawComponents = await page.evaluate(() => {
    return (window as any).__renderInspector__?.components ?? {};
  }) as Record<string, ComponentData>;

  const screenshotBuffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 60 });
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

  // Classify assertion failures: auth-related if the page URL is still the login/auth page
  const currentUrl = page.isClosed() ? '' : page.url();
  const isAuthFailure = assertionFailures.some(
    f => f.assertion.type === 'url' && authFailure == null,
  );

  return {
    page: pageConfig.name,
    url: pageConfig.url,
    issues,
    jsErrors,
    apiErrors,
    assertionFailures,
    authFailure: authFailure ?? (isAuthFailure ? 'Login assertion failed' : null),
    screenshotBase64,
    observeDuration,
    timestamp: new Date().toISOString(),
  };
}

const STACK_EXCLUDED = new Set([
  'Object', 'Array', 'Promise', 'Error', 'Function', 'Module',
  'eval', 'HTMLUnknownElement', 'HTMLElement', 'EventTarget',
]);

function extractReactComponents(stack: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const match of stack.matchAll(/at ([A-Z][a-zA-Z0-9]*)/g)) {
    const name = match[1];
    if (!STACK_EXCLUDED.has(name) && !seen.has(name)) {
      seen.add(name);
      results.push(name);
    }
  }
  return results.slice(0, 5);
}

async function runAssertions(page: Page, assertions: Assertion[]): Promise<AssertionResult[]> {
  const failures: AssertionResult[] = [];

  for (const assertion of assertions) {
    let passed = false;
    let actual: string | undefined;

    try {
      switch (assertion.type) {
        case 'url': {
          actual = page.url();
          passed = actual.includes(assertion.expected);
          break;
        }
        case 'visible': {
          passed = await page.locator(assertion.selector).first().isVisible({ timeout: 3000 });
          actual = passed ? 'visible' : 'not visible';
          break;
        }
        case 'hidden': {
          const visible = await page.locator(assertion.selector).first().isVisible().catch(() => false);
          passed = !visible;
          actual = visible ? 'still visible' : 'hidden ✓';
          break;
        }
        case 'text': {
          actual = await page.locator(assertion.selector).first().innerText({ timeout: 3000 });
          passed = actual.includes(assertion.contains);
          break;
        }
        case 'count': {
          const count = await page.locator(assertion.selector).count();
          actual = String(count);
          passed = count === assertion.expected;
          break;
        }
      }
    } catch (err) {
      passed = false;
      actual = `Error: ${(err as Error).message}`;
    }

    if (!passed) {
      failures.push({ assertion, passed: false, actual });
    }
  }

  return failures;
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

function summarizeCategories(report: PageReport): string {
  const parts: string[] = [];
  if (report.issues.length > 0) parts.push(`重渲染(${report.issues.length})`);
  if (report.jsErrors.length > 0) parts.push(`代码报错(${report.jsErrors.length})`);
  if (report.apiErrors.length > 0) parts.push(`接口报错(${report.apiErrors.length})`);
  if (report.authFailure) parts.push('登录失败');
  if (report.assertionFailures.length > 0) parts.push(`数据展示不全(${report.assertionFailures.length})`);
  return parts.join(' · ');
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
      if (action.description) console.log(`  [interact] ${action.description}`);

      switch (action.type) {
        case 'scroll': {
          const y = action.scrollY ?? 0;
          if (y <= 1) {
            await page.evaluate((pct: number) =>
              window.scrollTo({ top: document.body.scrollHeight * pct, behavior: 'smooth' }), y);
          } else {
            await page.evaluate((px: number) =>
              window.scrollTo({ top: px, behavior: 'smooth' }), y);
          }
          break;
        }
        case 'click': {
          if (action.selector) await page.locator(action.selector).first().click({ timeout: 3000 });
          break;
        }
        case 'hover': {
          if (action.selector) await page.locator(action.selector).first().hover({ timeout: 3000 });
          break;
        }
        case 'fill': {
          if (action.selector && action.value != null) {
            await page.locator(action.selector).first().fill(action.value, { timeout: 3000 });
          }
          break;
        }
        case 'waitForSelector': {
          if (action.selector) {
            await page.waitForSelector(action.selector, { timeout: action.waitMs ?? 5000 });
          }
          break;
        }
        case 'wait': {
          await page.waitForTimeout(action.waitMs ?? 500);
          break;
        }
      }
    } catch (err) {
      console.warn(`  [interact] skipped (${action.type} ${action.selector ?? ''}): ${(err as Error).message}`);
    }
  }
}
