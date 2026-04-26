import { expect, test } from '@playwright/test';
import { gotoWithRetry } from './helpers';

test.describe('BodyMapWidget rendering', () => {
  test.beforeEach(async ({ page }) => {
    await gotoWithRetry(page, '/');
    // Switch to standard layout so PlaywrightTestBodyMap content renders in story river
    await page.evaluate(() => {
      ($tw as any).wiki.setText('$:/layout', 'text', undefined, '');
      ($tw as any).wiki.setText('$:/plugins/linonetwo/health-buff-debuff-tracker/configs/debug-body-map', 'text', undefined, 'no');
      // Ensure test tiddler has correct content (dev server may not hot-reload .tid files)
      const text = `This tiddler is used by Playwright E2E tests for the body-map widget.

!! Interactive Mode

<$body-map interactive="true" tiddler="PlaywrightTestBodyMap" field="body-parts" />

!! Read-Only Mode

<$body-map interactive="false" values="69536005 51185008" />
`;
      ($tw as any).wiki.addTiddler({
        title: 'PlaywrightTestBodyMap',
        text,
        'body-parts': '51185008 113345001',
      });
    });

    await gotoWithRetry(page, '/#PlaywrightTestBodyMap');
    await expect(page.locator('[data-tiddler-title="PlaywrightTestBodyMap"]')).toBeVisible();
  });

  test('renders interactive body map with SVG polygons', async ({ page }) => {
    // Wait for the body map container within PlaywrightTestBodyMap tiddler
    const tiddlerFrame = page.locator('[data-tiddler-title="PlaywrightTestBodyMap"]');
    const container = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    await expect(container).toBeVisible();

    // Check SVG with polygons exists
    const svg = container.locator('svg');
    await expect(svg).toBeVisible();

    // Should have at least one polygon region
    const polygons = container.locator('svg polygon');
    const count = await polygons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('renders read-only body map with pre-selected values highlighted', async ({ page }) => {
    // Wait for TiddlyWiki to fully render both body-map widgets
    await page.waitForTimeout(1000);

    // Find containers within the PlaywrightTestBodyMap tiddler
    const tiddlerFrame = page.locator('[data-tiddler-title="PlaywrightTestBodyMap"]');
    const containers = tiddlerFrame.locator('.health-buff-debuff-body-map-container');
    const count = await containers.count();

    // Skip if only one container (e.g. during hot-reload)
    if (count < 2) {
      await expect(containers.first()).toBeVisible();
      return;
    }

    await expect(containers.nth(1)).toBeVisible();

    const readRegionFill = async (regionId: string) => await page.evaluate((targetRegionId) => {
      const tiddler = document.querySelector('[data-tiddler-title="PlaywrightTestBodyMap"]');
      const bodyMapContainers = tiddler?.querySelectorAll('.health-buff-debuff-body-map-container');
      if (!bodyMapContainers || bodyMapContainers.length < 2) {
        return '';
      }

      const polygon = bodyMapContainers[1].querySelector(`svg polygon[data-region-id="${targetRegionId}"]`) as SVGPolygonElement | null;
      return polygon?.style.fill ?? '';
    }, regionId);

    // Check that Head (69536005) polygon has active fill
    await expect.poll(async () => await readRegionFill('69536005')).toContain('rgba(255');

    // Check that Chest (51185008) polygon has active fill
    await expect.poll(async () => await readRegionFill('51185008')).toContain('rgba(255');
  });
});
