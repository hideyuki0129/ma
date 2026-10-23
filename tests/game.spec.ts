import { expect, test, type Page } from '@playwright/test';

async function touchPoint(page: Page, x: number, y: number) {
  const board = page.locator('#board');
  await board.scrollIntoViewIfNeeded();
  const rect = (await board.boundingBox())!;
  const xx = rect.x + x / 360 * rect.width, yy = rect.y + y / 360 * rect.height;
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(xx, yy);
  else await page.mouse.click(xx, yy);
}
async function draw(page: Page, a: [number, number], b: [number, number]) {
  await page.getByRole('tab', { name: '線を置く', exact: true }).click();
  await touchPoint(page, ...a);
  await touchPoint(page, ...b);
  await page.getByRole('button', { name: 'この線を置く', exact: true }).click();
}
async function solveFirst(page: Page) {
  await draw(page, [180, 84], [84, 180]);
  await draw(page, [84, 180], [180, 276]);
  await expect(page.getByRole('tab', { name: '色を置く' })).toHaveAttribute('aria-selected', 'true');
  await touchPoint(page, 126, 180);
  await draw(page, [180, 84], [276, 180]);
  await draw(page, [276, 180], [180, 276]);
  await touchPoint(page, 228, 180);
  await expect(page.locator('.goal-count')).toContainText('2');
  await expect(page.getByRole('button', { name: 'この一枚を残す' })).toBeEnabled();
}

test('portrait start, noncommitted preview, and help work without errors or horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /線を置く。\s*余白が、生まれる。/ })).toBeVisible();
  await page.getByRole('button', { name: '最初の一線を' }).click();
  await touchPoint(page, 180, 84);
  await touchPoint(page, 84, 180);
  await expect(page.locator('.preview-line')).toBeVisible();
  await expect(page.locator('.board-meta')).toContainText('のこり 12 手');
  await page.getByRole('button', { name: '一手戻す', exact: true }).click();
  await expect(page.locator('.preview-line')).toHaveCount(0);
  await expect(page.locator('.drawn-line')).toHaveCount(1);
  await page.getByRole('button', { name: '遊びかた' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '描いてみる' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('a full game, shared-boundary editing, undo, reload, gallery, exports, and next study', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '最初の一線を' }).click();
  await solveFirst(page);
  await expect(page.locator('.board-meta')).toContainText('のこり 6 手');
  await page.getByRole('tab', { name: '線を曲げる' }).click();
  await touchPoint(page, 160.8, 180);
  await page.getByRole('button', { name: '少し右に曲げる', exact: true }).click();
  await page.getByRole('button', { name: 'この曲がりにする' }).click();
  await expect(page.locator('.board-meta')).toContainText('のこり 5 手');
  await expect(page.locator('.goals')).toHaveClass(/all-done/);
  await page.getByRole('button', { name: '一手戻す', exact: true }).click();
  await expect(page.locator('.board-meta')).toContainText('のこり 6 手');
  await page.getByRole('button', { name: '一手やり直す', exact: true }).click();
  await expect(page.locator('.board-meta')).toContainText('のこり 5 手');
  await page.reload();
  await expect(page.locator('.board-meta')).toContainText('のこり 5 手');
  await expect(page.locator('.colored')).toHaveCount(2);
  await page.getByRole('button', { name: 'この一枚を残す' }).click();
  await page.getByRole('textbox', { name: '作品の名前' }).fill('ゆれる、ふたつ');
  await page.getByRole('button', { name: '作品集に残す' }).click();
  await expect(page.getByRole('heading', { name: 'あなたが選んだ、一枚。' })).toBeVisible();
  for (const format of ['PNG', 'SVG']) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: `${format}で保存` }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`\.${format.toLowerCase()}$`));
    const path = await download.path();
    expect(path).toBeTruthy();
  }
  await page.getByRole('button', { name: '次の間へ' }).click();
  await expect(page.getByRole('heading', { name: '余白の、通りみち。' })).toBeVisible();
  await page.getByRole('button', { name: '作品集', exact: true }).click();
  await expect(page.getByRole('button', { name: /ゆれる、ふたつ/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /ゆれる、ふたつ/ })).toBeVisible();
});

test('second study checks a real whitespace corridor, third study reuses split boundaries', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '3つの習作と、自由な制作' }).click();
  await page.getByRole('button', { name: /02 余白の、通りみち/ }).click();
  await draw(page, [228, 84], [180, 36]);
  await draw(page, [180, 36], [84, 84]);
  await touchPoint(page, 168, 70);
  await draw(page, [276, 276], [228, 324]);
  await draw(page, [228, 324], [132, 276]);
  await touchPoint(page, 210, 290);
  await expect(page.locator('.goals')).toHaveClass(/all-done/);
  await page.getByRole('button', { name: /STUDY 02/ }).click();
  await page.getByRole('button', { name: /03 線は、意味を変える/ }).click();
  await draw(page, [180, 84], [84, 84]);
  await draw(page, [84, 84], [84, 276]);
  await draw(page, [84, 276], [180, 276]);
  await touchPoint(page, 132, 180);
  await draw(page, [180, 84], [276, 84]);
  await draw(page, [276, 84], [276, 180]);
  await draw(page, [276, 180], [180, 180]);
  await touchPoint(page, 228, 132);
  await draw(page, [180, 276], [276, 276]);
  await draw(page, [276, 276], [276, 180]);
  await touchPoint(page, 228, 228);
  await expect(page.locator('.goals')).toHaveClass(/all-done/);
  await expect(page.locator('.board-meta')).toContainText('のこり 1 手');
  await expect(page.getByRole('button', { name: 'この一枚を残す' })).toBeEnabled();
});

test('installed offline assets reopen a saved composition without a network', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '最初の一線を' }).click();
  await draw(page, [180, 84], [84, 180]);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.board-meta')).toContainText('のこり 11 手');
  await expect(page.locator('.drawn-line')).toHaveCount(2);
  await draw(page, [84, 180], [180, 276]);
  await expect(page.locator('.face')).toHaveCount(1);
  await context.setOffline(false);
});
