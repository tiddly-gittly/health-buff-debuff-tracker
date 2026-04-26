import { expect, test } from '@playwright/test';
import { gotoWithRetry, openTiddlerWithRetry, readWikiField } from './helpers';

test.describe('BodyMapWidget click interaction', () => {
  const testTitle = 'PlaywrightTestBodyMap';

  test.beforeEach(async ({ page }) => {
    await gotoWithRetry(page, '/');
    await page.evaluate((title) => {
      ($tw as any).wiki.setText('$:/layout', 'text', undefined, '');
      ($tw as any).wiki.setText('$:/plugins/linonetwo/health-buff-debuff-tracker/configs/debug-body-map', 'text', undefined, 'no');
      ($tw as any).wiki.addTiddler({
        title,
        type: 'text/vnd.tiddlywiki',
        text: `This tiddler is used by Playwright click tests for the body-map widget.\n\n<$body-map interactive="true" tiddler="${title}" field="body-parts" />`,
        'body-parts': '',
      });
    }, testTitle);

    await openTiddlerWithRetry(page, testTitle);
    await expect.poll(async () => await readWikiField(page, testTitle, 'body-parts')).toBe('');
  });

  test('clicking a body region toggles the body-parts field', async ({ page }) => {
    // First interactive body map within the temporary click-test tiddler
    const tiddlerFrame = page.locator('[data-tiddler-title="PlaywrightTestBodyMap"]');
    const container = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    await expect(container).toBeVisible();

    // Click the Chest region (51185008) - use Chest to avoid sub-region overlap
    const chestPolygon = container.locator('svg polygon[data-region-id="51185008"]');
    await expect(chestPolygon).toBeVisible();
    await chestPolygon.dispatchEvent("click");

    await expect.poll(async () => await readWikiField(page, 'PlaywrightTestBodyMap', 'body-parts')).toContain('51185008');

    // Click again to deselect
    const updatedContainer = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    const updatedChest = updatedContainer.locator('svg polygon[data-region-id="51185008"]');
    await updatedChest.dispatchEvent("click");

    await expect.poll(async () => await readWikiField(page, 'PlaywrightTestBodyMap', 'body-parts')).toBe('');
  });

  test('clicking multiple regions accumulates values', async ({ page }) => {
    const tiddlerFrame = page.locator('[data-tiddler-title="PlaywrightTestBodyMap"]');
    const container = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    await expect(container).toBeVisible();

    // Click Chest
    await container.locator('svg polygon[data-region-id="51185008"]').dispatchEvent("click");
    await expect.poll(async () => await readWikiField(page, 'PlaywrightTestBodyMap', 'body-parts')).toContain('51185008');

    // Click Abdomen on the refreshed container
    const container2 = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    await container2.locator('svg polygon[data-region-id="113345001"]').dispatchEvent("click");

    await expect.poll(async () => await readWikiField(page, 'PlaywrightTestBodyMap', 'body-parts')).toContain('51185008');
    await expect.poll(async () => await readWikiField(page, 'PlaywrightTestBodyMap', 'body-parts')).toContain('113345001');
  });
});
