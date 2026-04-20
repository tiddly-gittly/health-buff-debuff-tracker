import { expect, test } from '@playwright/test';

test.describe('Body map editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#%24%3A%2Fplugins%2Flinonetwo%2Fhealth-buff-debuff-tracker%2Fpages%2FBodyMapEditor', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      ($tw as any).wiki.setText('$:/layout', 'text', undefined, '');
    });
    await page.waitForTimeout(1500);
  });

  test('renders draggable handles and keeps state stable while dragging', async ({ page }) => {
    const editor = page.locator('.health-buff-debuff-body-map-editor');
    await expect(editor).toBeVisible();

    const handles = editor.locator('.health-buff-debuff-body-map-editor-handle');
    await expect(handles.first()).toBeVisible();

    const beforeText = await editor.locator('textarea').inputValue();
    const handleBox = await handles.first().boundingBox();
    expect(handleBox).not.toBeNull();

    if (handleBox) {
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + handleBox.width / 2 + 24, handleBox.y + handleBox.height / 2 + 12, { steps: 8 });
      await page.mouse.up();
    }

    await expect(editor).toBeVisible();
    const afterText = await editor.locator('textarea').inputValue();
    expect(afterText).not.toBe(beforeText);
  });
});
