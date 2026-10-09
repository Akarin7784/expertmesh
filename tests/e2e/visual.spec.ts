import { test, expect, type Page, type Locator } from '@playwright/test';

async function navigate(page: Page, name: string) {
  if (await page.getByRole('button', { name: '打开导航', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
  }
  await page.getByRole('button', { name, exact: true }).click();
}

async function fitsViewport(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
}

async function insideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

for (const theme of ['light', 'dark']) {
  test(`notebook visual coverage: all pages and settings, ${theme}`, async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((theme) => localStorage.setItem('em-theme', theme), theme);
    await page.goto('/');
    const screens = [
      ['新对话', 'home'],
      ['任务', 'tasks'],
      ['项目', 'projects'],
      ['助手', 'assistants'],
      ['文件', 'files'],
      ['设置', 'settings'],
    ];
    const chapters = [
      '模型与服务商',
      '工具与权限',
      '联网搜索',
      '执行与工作区',
      '阅读与外观',
      '数据管理',
    ];
    for (const width of [1440, 1024, 768, 600, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [label, slug] of screens) {
        await navigate(page, label);
        await expect(page.locator('main h1')).toBeVisible();
        await fitsViewport(page);
        if (slug === 'home') {
          await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveCount(1);
          await insideViewport(page, page.locator('.composer'));
        }
        if (slug === 'projects') {
          const contrast = await page
            .getByRole('button', { name: '新建项目', exact: true })
            .evaluate((element) => {
              const context = document.createElement('canvas').getContext('2d')!;
              const luminance = (color: string) => {
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                const components = Array.from(context.getImageData(0, 0, 1, 1).data)
                  .slice(0, 3)
                  .map((value) => {
                    const n = value / 255;
                    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
                  });
                return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
              };
              const style = getComputedStyle(element);
              const a = luminance(style.color),
                b = luminance(style.backgroundColor);
              return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            });
          expect(contrast).toBeGreaterThanOrEqual(4.5);
        }
        if ([1440, 375].includes(width)) {
          await page.screenshot({
            path: `test-results/visual/${slug}-${theme}-${width}.png`,
            fullPage: true,
            animations: 'disabled',
          });
        }
      }
      for (let index = 0; index < chapters.length; index++) {
        await page.getByRole('tab', { name: chapters[index], exact: true }).click();
        await expect(page.getByRole('tabpanel')).toHaveCount(1);
        if (chapters[index] === '执行与工作区') {
          await expect(page.getByLabel('模型调用次数', { exact: true })).toBeVisible();
          await expect(page.getByText('正在检查环境…', { exact: true })).not.toBeVisible();
        }
        await fitsViewport(page);
        if ([1440, 375].includes(width)) {
          await page.screenshot({
            path: `test-results/visual/chapter-${index + 1}-${theme}-${width}.png`,
            fullPage: true,
            animations: 'disabled',
          });
        }
      }
    }
    expect(errors).toEqual([]);
  });
}

test('starter notes, real motion playback, keyboard controls and reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: '发送消息' });
  for (const [label, text] of [
    ['读一份资料', '阅读并整理'],
    ['写一段文字', '零散的想法'],
    ['理一个思路', '分析背景'],
  ]) {
    await page.getByRole('button', { name: label, exact: false }).click();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(new RegExp(text));
  }
  await page.getByRole('button', { name: '新对话', exact: true }).hover();
  await expect(page.locator('.new-chat > svg')).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
  await navigate(page, '项目');
  await expect(page.locator('.page-inner')).toHaveCSS('animation-name', 'page-arrive');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS('animation-name', 'dialog-arrive');
  const playback = await dialog.evaluate(async (element) => {
    const animation = element
      .getAnimations()
      .find((item) => item instanceof CSSAnimation && item.animationName === 'dialog-arrive');
    if (!animation) return null;
    // Replay the actual browser animation and sample distinct rendering frames.
    animation.currentTime = 0;
    animation.play();
    const start = getComputedStyle(element).opacity;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const middle = getComputedStyle(element).opacity;
    await animation.finished;
    return {
      start: Number(start),
      middle: Number(middle),
      end: Number(getComputedStyle(element).opacity),
    };
  });
  expect(playback).not.toBeNull();
  expect(playback!.start).toBeLessThan(playback!.middle);
  expect(playback!.end).toBe(1);
  await page.getByLabel('项目名称').fill('视觉检查草稿');
  await page.screenshot({ path: 'test-results/visual/project-dialog.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 850 });
  await expect(page.locator('.sidebar')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭导航', exact: true })).toBeFocused();
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '关闭导航', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '打开导航', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.sidebar')
        .evaluate((element) => Math.round(element.getBoundingClientRect().left)),
    )
    .toBe(0);
  await page.screenshot({ path: 'test-results/visual/mobile-drawer.png', animations: 'disabled' });
  await page
    .getByRole('button', { name: '收起导航', exact: true })
    .click({ position: { x: 350, y: 150 } });
  await expect
    .poll(() =>
      page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await navigate(page, '设置');
  await page.getByRole('tab', { name: '阅读与外观', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: '模型与服务商', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '添加服务', exact: true }).click();
  await insideViewport(page, dialog);
  await page.getByLabel('服务商', { exact: true }).click();
  await insideViewport(page, page.getByRole('listbox'));
  await page.screenshot({
    path: 'test-results/visual/mobile-model-dialog.png',
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await navigate(page, '新对话');
  await expect(page.locator('.welcome')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.new-chat > svg')).toHaveCSS('transition-duration', '0s');
  await navigate(page, '项目');
  await expect(page.locator('.page-inner')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(dialog).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
});

test('editor, confirmation and file dialogs stay usable in both themes and on narrow screens', async ({
  page,
}) => {
  test.setTimeout(60000);
  const projectResponse = await page.request.post('/api/projects', {
    data: { name: '视觉验收笔记', instructions: '收集阅读片段、写作草稿与日常灵感。' },
  });
  expect(projectResponse.ok()).toBe(true);
  const upload = await page.request.post('/api/files', {
    multipart: {
      projectId: '',
      files: {
        name: '视觉验收长文.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(
          '# 一页阅读笔记\n\n> 留一页空白，给新的想法。\n\n' +
            '这是一段用于检查阅读行距、自动换行与滚动的文字。'.repeat(70) +
            '\n\n```ts\nconst note = "继续思考";\n```',
        ),
      },
    },
  });
  expect(upload.ok()).toBe(true);
  const dialog = page.getByRole('dialog');
  for (const theme of ['light', 'dark']) {
    await page.goto('/');
    await page.evaluate((theme) => localStorage.setItem('em-theme', theme), theme);
    await page.reload();
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await navigate(page, '项目');
      await page.getByRole('button', { name: '编辑项目 视觉验收笔记', exact: true }).click();
      await insideViewport(page, dialog);
      await expect(page.getByLabel('项目说明')).toHaveValue('收集阅读片段、写作草稿与日常灵感。');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '删除项目 视觉验收笔记', exact: true }).click();
      await insideViewport(page, dialog);
      await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeVisible();
      if (width !== 320)
        await page.screenshot({
          path: `test-results/visual/confirm-${theme}-${width}.png`,
          animations: 'disabled',
        });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.getByRole('heading', { name: '视觉验收笔记', exact: true })).toBeVisible();

      await navigate(page, '助手');
      await page.getByRole('button', { name: '创建助手', exact: true }).click();
      await insideViewport(page, dialog);
      await page.getByLabel('名称', { exact: true }).fill('阅读同行者');
      await page.getByLabel('用途', { exact: true }).fill('整理阅读笔记');
      await page.getByLabel('工作要求', { exact: true }).fill('先梳理脉络，再讨论值得思考的观点。');
      if (width !== 320)
        await page.screenshot({
          path: `test-results/visual/assistant-dialog-${theme}-${width}.png`,
          animations: 'disabled',
        });
      await page.getByRole('button', { name: '取消', exact: true }).click();

      await navigate(page, '文件');
      await page.locator('.file-name').filter({ hasText: '视觉验收长文.md' }).click();
      await insideViewport(page, dialog);
      await expect(dialog.locator('.markdown h1')).toHaveText('一页阅读笔记');
      expect(
        await dialog
          .locator('.file-preview')
          .evaluate((element) => element.scrollHeight > element.clientHeight),
      ).toBe(true);
      await fitsViewport(page);
      if (width !== 320)
        await page.screenshot({
          path: `test-results/visual/file-dialog-${theme}-${width}.png`,
          animations: 'disabled',
        });
      await page.keyboard.press('Escape');
    }
  }
});
