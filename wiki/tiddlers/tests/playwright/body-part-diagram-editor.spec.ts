import { expect, test } from '@playwright/test';
import { gotoWithRetry } from './helpers';

const editorPage = '/#%24%3A%2Fplugins%2Flinonetwo%2Fbody-part-diagram-editor%2Fpages%2FBodyPartDiagramEditor';
const sourceImageTitle = '$:/plugins/linonetwo/health-buff-debuff-tracker/img/body.webp';
const tempImageTitle = 'PlaywrightBodyPartDiagramImage';

test.describe('Body part diagram editor', () => {
  test.beforeEach(async ({ page }) => {
    await gotoWithRetry(page, '/');
    await page.evaluate(({ sourceImageTitle, tempImageTitle }) => {
      const tw = $tw as any;
      const source = tw.wiki.getTiddler(sourceImageTitle);
      tw.wiki.addTiddler(new tw.Tiddler(source, {
        ...source?.fields,
        title: tempImageTitle,
        caption: tempImageTitle,
      }));
    }, { sourceImageTitle, tempImageTitle });

    await gotoWithRetry(page, editorPage);
    await page.evaluate(() => {
      ($tw as any).wiki.setText('$:/layout', 'text', undefined, '');
    });
    await expect(page.locator('.body-part-diagram-editor')).toBeVisible();
  });

  test('lets you switch image tiddlers and generate regions in-browser', async ({ page }) => {
    const editor = page.locator('.body-part-diagram-editor');
    await expect(editor).toBeVisible();

    const imageSelect = page.getByLabel('Image tiddler');
    await expect(imageSelect).toBeVisible();
    await imageSelect.selectOption(tempImageTitle);

    await expect(editor).toContainText(tempImageTitle);
    await expect(page.getByLabel('Generated meta output')).toHaveValue(new RegExp(`title: ${tempImageTitle}`));

    await page.getByRole('button', { name: 'Generate Regions' }).click();

    await expect(editor).toContainText('Generated 33 regions in the browser.');
    await expect(editor.locator('pre')).toContainText('wristRightY');
  });

  test('keeps drag edits local until save and then writes them back to the selected image tiddler', async ({ page }) => {
    const editor = page.locator('.body-part-diagram-editor');
    await expect(editor).toBeVisible();

    await page.getByLabel('Image tiddler').selectOption(tempImageTitle);
    await expect(editor).toContainText(tempImageTitle);
    await expect(page.getByLabel('Generated meta output')).toHaveValue(new RegExp(`title: ${tempImageTitle}`));

    await page.getByRole('button', { name: 'Generate Regions' }).click();
    await expect(editor.locator('pre')).toContainText('wristRightY');

    const metaOutput = page.getByLabel('Generated meta output');
    const beforeText = await metaOutput.inputValue();
    const beforeSavedField = await page.evaluate((title) => ($tw as any).wiki.getTiddler(title)?.fields?.['body-region-abdomen'] || '', tempImageTitle);

    const handles = editor.locator('.body-part-diagram-editor-handle');
    await expect(handles.first()).toBeVisible();
    const handleBox = await handles.first().boundingBox();
    expect(handleBox).not.toBeNull();

    if (handleBox) {
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + handleBox.width / 2 + 24, handleBox.y + handleBox.height / 2 + 12, { steps: 8 });
      await page.mouse.up();
    }

    const afterText = await metaOutput.inputValue();
    expect(afterText).not.toBe(beforeText);

    await page.getByRole('button', { name: 'Save To Image Meta' }).click();

    await expect.poll(async () => await page.evaluate((title) => ($tw as any).wiki.getTiddler(title)?.fields?.['body-region-abdomen'] || '', tempImageTitle)).not.toBe(beforeSavedField);
    await expect(metaOutput).toHaveValue(new RegExp(`title: ${tempImageTitle}`));
  });
});