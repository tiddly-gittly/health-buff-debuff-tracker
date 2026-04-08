import { expect, test } from '@playwright/test';

test.describe('BodyMapWidget rendering', () => {
  test('renders interactive body map with SVG polygons', async ({ page }) => {
    await page.goto('/#PlaywrightTestBodyMap');

    // Wait for the body map container to appear
    const container = page.locator('.health-buff-debuff-body-map-container').first();
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
    await page.goto('/#PlaywrightTestBodyMap');

    // The second body-map is read-only with values="368328007 51185008"
    const containers = page.locator('.health-buff-debuff-body-map-container');
    await expect(containers.nth(1)).toBeVisible();

    // Check that Head (368328007) polygon has active fill
    const headPolygon = containers.nth(1).locator('svg polygon[data-region-id="368328007"]');
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
