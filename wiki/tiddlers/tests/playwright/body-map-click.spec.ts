import { expect, test } from '@playwright/test';

test.describe('BodyMapWidget click interaction', () => {
  test('clicking a body region toggles the body-parts field', async ({ page }) => {
    await page.goto('/#PlaywrightTestBodyMap');

    // First interactive body map
    const container = page.locator('.health-buff-debuff-body-map-container').first();
    await expect(container).toBeVisible();

    // Click the Head region (368328007)
    const headPolygon = container.locator('svg polygon[data-region-id="368328007"]');
    await expect(headPolygon).toBeVisible();
    await headPolygon.click();

    // After click, the widget should refresh with head highlighted
    // Wait for re-render
    await page.waitForTimeout(500);

    // The field should now contain the SNOMED code
    // We can verify by checking the polygon style changed to active
    const updatedContainer = page.locator('.health-buff-debuff-body-map-container').first();
    const updatedHead = updatedContainer.locator('svg polygon[data-region-id="368328007"]');
    const headFill = await updatedHead.evaluate((el) => el.style.fill);
    expect(headFill).toContain('rgba(255');

    // Click again to deselect
    await updatedHead.click();
    await page.waitForTimeout(500);

    // Move mouse away from the polygon to clear hover effect
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);

    const deselectedContainer = page.locator('.health-buff-debuff-body-map-container').first();
    const deselectedHead = deselectedContainer.locator('svg polygon[data-region-id="368328007"]');
    const deselectedFill = await deselectedHead.evaluate((el) => el.style.fill);
    expect(deselectedFill).toContain('rgba(100');
  });

  test('clicking multiple regions accumulates values', async ({ page }) => {
    await page.goto('/#PlaywrightTestBodyMap');

    const container = page.locator('.health-buff-debuff-body-map-container').first();
    await expect(container).toBeVisible();

    // Click Head
    await container.locator('svg polygon[data-region-id="368328007"]').click();
    await page.waitForTimeout(300);

    // Click Chest
    const updatedContainer = page.locator('.health-buff-debuff-body-map-container').first();
    await updatedContainer.locator('svg polygon[data-region-id="51185008"]').click();
    await page.waitForTimeout(300);

    // Both should now be highlighted
    const finalContainer = page.locator('.health-buff-debuff-body-map-container').first();
    const headFill = await finalContainer.locator('svg polygon[data-region-id="368328007"]').evaluate((el) => el.style.fill);
    const chestFill = await finalContainer.locator('svg polygon[data-region-id="51185008"]').evaluate((el) => el.style.fill);
    expect(headFill).toContain('rgba(255');
    expect(chestFill).toContain('rgba(255');
  });
});
