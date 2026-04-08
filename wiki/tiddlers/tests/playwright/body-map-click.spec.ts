import { expect, test } from '@playwright/test';

test.describe('BodyMapWidget click interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#PlaywrightTestBodyMap', { waitUntil: 'networkidle' });
    // Switch to standard layout so PlaywrightTestBodyMap content renders in story river
    await page.evaluate(() => {
      ($tw as any).wiki.setText('$:/layout', 'text', undefined, '');
      ($tw as any).wiki.setText('PlaywrightTestBodyMap', 'body-parts', undefined, '');
    });
    // Wait for layout switch and widget re-render
    await page.waitForTimeout(2000);
  });

  test('clicking a body region toggles the body-parts field', async ({ page }) => {
    // First interactive body map within PlaywrightTestBodyMap tiddler
    const tiddlerFrame = page.locator('[data-tiddler-title="PlaywrightTestBodyMap"]');
    const container = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    await expect(container).toBeVisible();

    // Click the Chest region (51185008) - use Chest to avoid sub-region overlap
    const chestPolygon = container.locator('svg polygon[data-region-id="51185008"]');
    await expect(chestPolygon).toBeVisible();
    await chestPolygon.click();

    // After click, the widget should refresh with chest highlighted
    // Wait for re-render
    await page.waitForTimeout(500);

    // The field should now contain the SNOMED code
    // We can verify by checking the polygon style changed to active
    const updatedContainer = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    const updatedChest = updatedContainer.locator('svg polygon[data-region-id="51185008"]');
    const chestFill = await updatedChest.evaluate((el) => el.style.fill);
    expect(chestFill).toContain('rgba(255');

    // Click again to deselect
    await updatedChest.click();
    await page.waitForTimeout(500);

    // Move mouse away from the polygon to clear hover effect
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);

    const deselectedContainer = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    const deselectedChest = deselectedContainer.locator('svg polygon[data-region-id="51185008"]');
    const deselectedFill = await deselectedChest.evaluate((el) => el.style.fill);
    expect(deselectedFill).toContain('rgba(100');
  });

  test('clicking multiple regions accumulates values', async ({ page }) => {
    const tiddlerFrame = page.locator('[data-tiddler-title="PlaywrightTestBodyMap"]');
    const container = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    await expect(container).toBeVisible();

    // Click Chest
    await container.locator('svg polygon[data-region-id="51185008"]').click();
    await page.waitForTimeout(1000);

    // Verify chest was added
    const afterFirstClick = await page.evaluate(() => ($tw as any).wiki.getTiddler('PlaywrightTestBodyMap')?.fields?.['body-parts']);
    expect(afterFirstClick).toContain('51185008');

    // Click Abdomen on the refreshed container
    const container2 = tiddlerFrame.locator('.health-buff-debuff-body-map-container').first();
    await container2.locator('svg polygon[data-region-id="113345001"]').click();
    await page.waitForTimeout(1000);

    // Verify both are in the field
    const afterSecondClick = await page.evaluate(() => ($tw as any).wiki.getTiddler('PlaywrightTestBodyMap')?.fields?.['body-parts']);
    expect(afterSecondClick).toContain('51185008');
    expect(afterSecondClick).toContain('113345001');
  });
});
