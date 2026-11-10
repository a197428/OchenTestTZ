import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const canvas = '[data-testid="canvas"]';
const objects = '[data-instance-id]';
const layers = '[data-layer-id]';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(canvas)).toBeVisible();
  await expect(page.locator('[data-object="book"]')).toBeVisible();
});

test('adds, drags, duplicates, deletes and undoes', async ({ page }) => {
  await page.locator('[data-object="book"]').click();
  const object = page.locator('[data-object-id="book"]');
  await expect(object).toHaveCount(1);
  const before = await object.getAttribute('transform');

  const box = await object.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y + box!.height / 2 + 50, {
    steps: 8,
  });
  await page.mouse.up();

  await expect(object).not.toHaveAttribute('transform', before ?? '');

  await page.keyboard.press('Control+d');
  await expect(page.locator(objects)).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator(objects)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator(objects)).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator(objects)).toHaveCount(1);
});

test('switches size, palette, format and substrate', async ({ page }) => {
  await page.locator('[data-object="book"]').click();
  await expect(page.locator('[data-object-id="book"] path')).toHaveCount(53);

  await page.locator('[data-size="S"]').click();
  await expect(page.locator(canvas)).toHaveAttribute('data-scene-size', 'S');
  await expect(page.locator('[data-object-id="book"] path')).toHaveCount(50);

  await page.locator('[data-palette="teal"]').click();
  await expect(page.locator(canvas)).toHaveAttribute('data-scene-palette', 'teal');
  await expect(page.locator('[data-object-id="book"] path[fill="#FFD4F2"]')).not.toHaveCount(0);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('[data-format="wide"]').click();
  await expect(page.locator(canvas)).toHaveAttribute('data-scene-format', 'wide');
  await expect(page.locator('[data-testid="scene-svg"]')).toHaveAttribute(
    'viewBox',
    '0 0 1200 630',
  );

  await page.locator('[data-substrate="none"]').click();
  await expect(page.locator(canvas)).toHaveAttribute('data-scene-substrate', 'none');
  await expect(page.locator('svg [data-substrate]')).toHaveCount(0);

  await page.locator('[data-substrate="diagonal"]').click();
  await expect(page.locator('svg [data-substrate="diagonal"]')).toHaveCount(1);
});

test('selects layers, changes state, warns on rotation and reorders', async ({ page }) => {
  await page.locator('[data-object="book"]').click();
  await page.locator('[data-object="phone"]').click();
  await expect(page.locator(layers)).toHaveCount(2);

  await page.locator(layers).nth(1).locator('button').click();
  await expect(page.locator('aside').last()).toContainText('Книга');

  await page.locator('aside [data-state="bg"]').click();
  await expect(page.locator('[data-object-id="book"]')).toHaveAttribute('data-state', 'bg');

  await page.locator('[data-field="rotation"]').fill('15');
  await expect(page.getByText('Поворот нарушает изометрию').first()).toBeVisible();

  const before = await page
    .locator(objects)
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-instance-id')));
  await page.locator('[data-action="layer-forward"]').click();
  const after = await page
    .locator(objects)
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-instance-id')));
  expect(after).not.toEqual(before);

  await page.locator('[data-action="duplicate"]').click();
  await expect(page.locator(objects)).toHaveCount(3);
  await page.locator('[data-action="delete"]').click();
  await expect(page.locator(objects)).toHaveCount(2);
});

test('persists the scene across reloads', async ({ page }) => {
  await page.locator('[data-object="book"]').click();
  await expect(page.locator(objects)).toHaveCount(1);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator(canvas)).toBeVisible();
  await expect(page.locator(objects)).toHaveCount(1);
});

test('downloads a lint-clean SVG', async ({ page }) => {
  await page.locator('[data-object="book"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="download"]').click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(file).not.toBeNull();
  const svg = readFileSync(file!, 'utf8');
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain('viewBox="0 0 1000 1000"');
  expect(svg).not.toMatch(/<image|<foreignObject|<style|class=/);
  expect(svg).toContain('id="ic1-background"');
  expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(50);
});

test('keeps interactive frame rate with eight objects', async ({ page }) => {
  const ids = ['book', 'phone', 'puzzle', 'coin', 'headphones', 'lamp', 'tulips', 'wallet'];
  for (const id of ids) {
    await page.locator(`[data-object="${id}"]`).click();
  }
  await expect(page.locator(objects)).toHaveCount(8);

  const average = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const times: number[] = [];
        let last = performance.now();
        let frames = 0;
        const tick = (now: number): void => {
          times.push(now - last);
          last = now;
          frames++;
          if (frames < 120) {
            requestAnimationFrame(tick);
          } else {
            const measured = times.slice(10);
            resolve(measured.reduce((sum, value) => sum + value, 0) / measured.length);
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`average frame time: ${average.toFixed(2)}ms`);
  expect(average).toBeLessThan(25);
});

test('relayouts with another variant and adds a backdrop', async ({ page }) => {
  await page.locator('[data-object="book"]').click();
  await page.locator('[data-object="phone"]').click();
  const before = await page
    .locator(objects)
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('transform')));
  await page.locator('[data-action="more"]').click();
  await expect(page.locator(objects)).toHaveCount(2);
  const after = await page
    .locator(objects)
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('transform')));
  expect(after).not.toEqual(before);

  await page.locator('[data-object="headphones"]').click();
  await page.locator('[data-object="tulips"]').click();
  await page.locator('[data-bg-mode="on"]').click();
  await expect(page.locator('[data-state="bg"]')).not.toHaveCount(0);
  await expect(page.locator('[data-state="main"]')).not.toHaveCount(0);
});

test('composes from a metaphor with the local fallback', async ({ page }) => {
  await page.getByTestId('meaning-input').fill('обучение');
  await page.locator('[data-action="compose-meaning"]').click();
  await expect(page.getByTestId('meaning-result')).toBeVisible();
  await expect(page.locator(objects)).not.toHaveCount(0);
  const fit = await page.getByTestId('meaning-result').getAttribute('data-fit');
  expect(['good', 'approximate', 'weak']).toContain(fit);
  await expect(page.getByText('LLM недоступен, использован локальный подбор.')).toBeVisible();
});

test('composes from comma-separated names', async ({ page }) => {
  await page.getByRole('tab', { name: 'По названиям' }).click();
  await page.getByTestId('names-input').fill('телефон, книга');
  await page.getByTestId('names-input').press('Enter');
  await expect(page.locator('[data-chip]')).toHaveCount(2);
  await page.locator('[data-action="compose-names"]').click();
  await expect(page.locator(objects)).toHaveCount(2);
});

test('loads a custom palette through the dialog', async ({ page }) => {
  await page.locator('[data-action="load-palette"]').click();
  await expect(page.getByTestId('palette-dialog')).toBeVisible();
  await page.getByTestId('palette-input').fill('#112233 #445566 #778899 #AABBCC #DDEEFF #FFEEDD');
  await page.locator('[data-action="parse-palette"]').click();
  await expect(page.getByTestId('palette-dialog').locator('input[type="color"]')).toHaveCount(8);
  await page.locator('[data-action="apply-palette"]').click();
  await expect(page.getByTestId('palette-dialog')).toHaveCount(0);
  const paletteId = await page.locator(canvas).getAttribute('data-scene-palette');
  expect(paletteId).toMatch(/^custom-/);
});

test('shows the empty state and changes scene scale', async ({ page }) => {
  await expect(page.getByText('Сцена пуста')).toBeVisible();
  await page.locator('input[type="range"]').fill('1.2');
  await expect(page.locator(canvas)).toHaveAttribute('data-scene-scale', '1.2');
});
