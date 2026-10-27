'use strict';
const { test, expect } = require('@playwright/test');

async function renderPaint(page, model, color, theme) {
  await page.evaluate(({ model, color, theme }) => {
    const data = normalizeData(buildProfile(model, 0, { color, odometer: 1000 }));
    data.car.color = color;
    session.setVehicles([{ id: 'framing', data }], 'framing');
    applyTheme(theme);
    applyAccent();
    renderTopbar();
    go('dashboard');
  }, { model, color, theme });
  await page.waitForFunction(() => {
    const image = document.querySelector('.studio-car');
    return image && image.complete && image.naturalWidth > 0;
  });
}

async function visibleBounds(page) {
  return page.locator('.studio-car').evaluate(image => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const rect = image.getBoundingClientRect();
    const card = image.closest('.car-studio').getBoundingClientRect();
    const style = getComputedStyle(image);
    const boxWidth = parseFloat(style.width), boxHeight = parseFloat(style.height);
    const fit = (style.objectFit === 'cover' ? Math.max : Math.min)(boxWidth / canvas.width, boxHeight / canvas.height);
    const contentWidth = canvas.width * fit / boxWidth * rect.width;
    const contentHeight = canvas.height * fit / boxHeight * rect.height;
    const contentLeft = rect.left + (rect.width - contentWidth) / 2;
    const contentTop = rect.top + (rect.height - contentHeight) / 2;
    return {
      aspect: contentWidth / contentHeight,
      cardWidth: card.width,
      cardHeight: card.height,
      bounds: [
        contentLeft - card.left + left / canvas.width * contentWidth,
        contentTop - card.top + top / canvas.height * contentHeight,
        contentLeft - card.left + right / canvas.width * contentWidth,
        contentTop - card.top + bottom / canvas.height * contentHeight
      ]
    };
  });
}

for (const model of ['cx80', 'cx90']) for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
  test(`${model} colour changes keep the same frame at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(testInfo.project.metadata.appUrl);
    await page.waitForFunction(() => window.session && session.booted());
    const colors = await page.evaluate(model => CAR_MODELS.find(m => m.id === model).colors, model);
    await renderPaint(page, 'cx3', 'Machine Gray Metallic (Code 46G)', theme);
    const standardWidth = await visibleBounds(page);
    await renderPaint(page, 'cx70', 'Polymetal Gray Metallic (Code 47C)', theme);
    const standardBaseline = await visibleBounds(page);
    await renderPaint(page, model, 'Machine Gray Metallic (Code 46G)', theme);
    const reference = await visibleBounds(page);
    expect(Math.abs(reference.aspect - 1.5)).toBeLessThan(.001);
    expect(Math.abs((reference.bounds[2] - reference.bounds[0]) - (standardWidth.bounds[2] - standardWidth.bounds[0])), JSON.stringify({ reference, standardWidth })).toBeLessThan(.15);
    expect(Math.abs(reference.bounds[3] - standardBaseline.bounds[3])).toBeLessThan(.15);
    expect(Math.abs((reference.bounds[0] + reference.bounds[2]) / 2 - (standardWidth.bounds[0] + standardWidth.bounds[2]) / 2)).toBeLessThan(.15);
    for (const color of colors) {
      await page.locator('.car-studio').click();
      await page.getByRole('radio', { name: color, exact: true }).click();
      await expect(page.locator('#modalHost')).toBeHidden();
      await page.waitForFunction(() => {
        const image = document.querySelector('.studio-car');
        return image.complete && image.naturalWidth > 0;
      });
      const actual = await visibleBounds(page);
      expect(Math.abs(actual.aspect - 1.5)).toBeLessThan(.001);
      for (let i = 0; i < 4; i++) {
        expect(Math.abs(actual.bounds[i] - reference.bounds[i]), `${color}: edge ${i} shifted`).toBeLessThan(.15);
      }
      if (testInfo.project.name === 'http' && width === 390 && theme === 'light') {
        await page.locator('.car-studio').screenshot({ path: testInfo.outputPath(`${model}-${colors.indexOf(color)}.png`) });
      }
    }
    await renderPaint(page, model, 'Soul Red Crystal Metallic (Code 46V)', theme);
    await page.locator('.studio-car').evaluate(image => image.dispatchEvent(new Event('error')));
    await page.waitForFunction(model => {
      const image = document.querySelector('.studio-car');
      return image.complete && image.naturalWidth > 0 && image.getAttribute('src') === `assets/mazda-${model}.webp?v=cx-family-fixes-211`;
    }, model);
    const fallback = await visibleBounds(page);
    for (let i = 0; i < 4; i++) expect(Math.abs(fallback.bounds[i] - reference.bounds[i])).toBeLessThan(.15);
    await renderPaint(page, 'cx60', 'Rhodium White Premium (Code 51K)', theme);
    await expect(page.locator('.studio-car')).not.toHaveClass(/aligned/);
    if (testInfo.project.name === 'http' && model === 'cx80' && width === 390 && theme === 'light') {
      const models = await page.evaluate(() => CAR_MODELS.map(m => m.id));
      for (const other of models) {
        await renderPaint(page, other, 'Image QA fallback', theme);
        const actual = await visibleBounds(page);
        expect(actual.bounds[0]).toBeGreaterThanOrEqual(0);
        expect(actual.bounds[1]).toBeGreaterThanOrEqual(0);
        expect(actual.bounds[2]).toBeLessThanOrEqual(actual.cardWidth);
        expect(actual.bounds[3]).toBeLessThanOrEqual(actual.cardHeight);
        await page.locator('.car-studio').screenshot({ path: testInfo.outputPath(`${other}-reference.png`) });
      }
    }
    expect(errors).toEqual([]);
  });
}
