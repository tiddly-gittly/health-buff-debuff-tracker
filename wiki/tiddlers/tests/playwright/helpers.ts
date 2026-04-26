import type { Page } from '@playwright/test';

export async function gotoWithRetry(page: Page, url: string, attempts = 5) {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const globalWindow = window as Window & { $tw?: { wiki?: unknown } };
        return Boolean(globalWindow.$tw?.wiki);
      });
      return;
    } catch (error) {
      lastError = error;
      if (index === attempts - 1) {
        throw error;
      }
      await page.waitForTimeout(600);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Navigation failed.');
}

export async function readWikiField(page: Page, title: string, field: string) {
  return page.evaluate(({ targetTitle, targetField }) => {
    const globalWindow = window as Window & {
      $tw?: {
        wiki?: {
          getTiddler: (title: string) => { fields?: Record<string, string> } | undefined;
        };
      };
    };
    return globalWindow.$tw?.wiki?.getTiddler(targetTitle)?.fields?.[targetField] ?? '';
  }, { targetTitle: title, targetField: field });
}