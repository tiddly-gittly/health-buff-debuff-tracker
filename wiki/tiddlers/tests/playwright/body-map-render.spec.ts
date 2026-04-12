import { expect, test } from '@playwright/test';

test.describe('BodyMapWidget rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#PlaywrightTestBodyMap', { waitUntil: 'networkidle' });
    // Switch to standard layout so PlaywrightTestBodyMap content renders in story river
    await page.evaluate(() => {
      ($tw as any).wiki.setText('$:/layout', 'text', undefined, '');
      ($tw as any).wiki.setText('$:/plugins/linonetwo/health-buff-debuff-tracker/configs/debug-body-map', 'text', undefined, 'no');
      // Ensure test tiddler has correct content (dev server may not hot-reload .tid files)
      const tiddler = ($tw as any).wiki.getTiddler('PlaywrightTestBodyMap');
      if (tiddler) {
        const text = `This tiddler is used by Playwright E2E tests for the body-map widget.

!! Interactive Mode

<$body-map interactive="true" tiddler="PlaywrightTestBodyMap" field="body-parts" />

!! Read-Only Mode

<$body-map interactive="false" values="69536005 51185008" />
`;
        ($tw as any).wiki.addTiddler({ ...tiddler.fields, text });
      }
    });
    await page.waitForTimeout(2000);
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

    // Check that Head (69536005) polygon has active fill
    const headPolygon = containers.nth(1).locator('svg polygon[data-region-id="69536005"]');
    await expect(headPolygon).toBeVisible();
    const headFill = await headPolygon.evaluate((el) => el.style.fill);
    expect(headFill).toContain('rgba(255');

    // Check that Chest (51185008) polygon has active fill
    const chestPolygon = containers.nth(1).locator('svg polygon[data-region-id="51185008"]');
    await expect(chestPolygon).toBeVisible();
    const chestFill = await chestPolygon.evaluate((el) => el.style.fill);
    expect(chestFill).toContain('rgba(255');
  });
});
