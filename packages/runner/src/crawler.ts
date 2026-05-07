import type { BrowserContext } from 'playwright';
import type { PageConfig } from './types';

/**
 * Crawls same-origin links from the root URL using an existing browser context.
 * Returns a deduplicated list of page configs, root page first.
 */
export async function crawlPages(
  context: BrowserContext,
  baseUrl: string,
  maxPages = 20,
): Promise<PageConfig[]> {
  const origin = new URL(baseUrl).origin;
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });

    const hrefs = await page.evaluate((sameOrigin: string) => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => (a as HTMLAnchorElement).href)
        .filter(href => href.startsWith(sameOrigin));
    }, origin);

    const seen = new Set<string>();
    const pages: PageConfig[] = [];

    const add = (url: string) => {
      try {
        const u = new URL(url);
        // drop query string and hash, keep origin + pathname
        const clean = u.origin + u.pathname;
        if (seen.has(clean)) return;
        seen.add(clean);
        pages.push({ name: u.pathname, url: clean });
      } catch { /* ignore malformed */ }
    };

    // Root page always first
    add(baseUrl);

    for (const href of hrefs) {
      if (pages.length >= maxPages) break;
      add(href);
    }

    return pages;
  } finally {
    await page.close();
  }
}
