import { test, expect } from '@playwright/test';
test('onboarding, uploads, real API roundtrip, projects, assistants and responsive themes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天，我们一起完成什么？' })).toBeVisible();
  await page.getByRole('button', { name: '连接模型' }).click();
  await page.getByLabel('服务商', { exact: true }).selectOption('compatible');
  await page.getByLabel('连接名称').fill('测试服务');
  await page.getByLabel('API Key', { exact: false }).fill('test-secret');
  await page.getByLabel('服务地址').fill('http://127.0.0.1:3901/v1');
  await page.getByLabel('允许本地或内网服务').check();
  await page.getByLabel('模型 ID 1', { exact: true }).fill('fixture-model');
  await page.getByLabel('模型显示名称 1', { exact: true }).fill('测试模型');
  await page.getByRole('button', { name: '保存连接' }).click();
  await expect(page.getByLabel('选择模型')).toHaveValue(/fixture-model/);
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称').fill('产品资料');
  await page.getByLabel('项目说明').fill('比较主流产品的体验');
  await page.getByRole('button', { name: '保存项目' }).click();
  await page.getByRole('button', { name: '开始对话', exact: true }).click();
  await page.getByLabel('上传资料', { exact: true }).setInputFiles({
    name: '需求.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 需求\n这是用户上传的资料。'),
  });
  await expect(page.locator('.attachments')).toContainText('需求.md');
  await page.getByLabel('工作模式').selectOption('task');
  await page.getByRole('textbox', { name: '发送消息' }).fill('请协作整理资料，生成报告');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/已完成/, { timeout: 20000 });
  await expect(page.locator('.markdown')).toContainText('协作已完成');
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/已完成/, { timeout: 20000 });
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/bootstrap');
      return (await response.json()).conversations.length;
    })
    .toBe(2);
  await page.getByRole('button', { name: '任务结果.md', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('协作已完成');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '请协作整理资料，生成报告', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('协作已完成');
  await page.getByRole('button', { name: '编辑并重发问题', exact: true }).click();
  await page.getByRole('textbox', { name: '发送消息' }).fill('请重新整理资料，调整报告重点');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/已完成/, { timeout: 20000 });
  await expect(page.locator('.user-bubble')).toContainText('调整报告重点');
  await expect
    .poll(
      async () => (await (await page.request.get('/api/bootstrap')).json()).conversations.length,
    )
    .toBe(3);
  await page.getByRole('button', { name: '助手', exact: true }).click();
  await page.getByRole('button', { name: '创建助手', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('文案助手');
  await page.getByLabel('用途').fill('产品介绍');
  await page.getByLabel('工作要求').fill('先给结论，再给建议');
  await page.getByRole('button', { name: '保存助手' }).click();
  await expect(page.getByRole('heading', { name: '文案助手' })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('连接成功，已获取模型列表')).toBeVisible();
  await page.getByLabel('搜索服务', { exact: true }).selectOption('searxng');
  await page.getByLabel('搜索服务地址', { exact: true }).fill('http://127.0.0.1:3901');
  await page.getByLabel('启用联网搜索', { exact: true }).check();
  await page.getByRole('button', { name: '保存搜索设置', exact: true }).click();
  await expect(page.getByText('搜索设置已保存')).toBeVisible();
  await page.locator('summary').filter({ hasText: '测试搜索' }).click();
  await page.getByLabel('测试搜索词').fill('Agent 最新资料');
  await page.getByRole('button', { name: '测试搜索', exact: true }).click();
  await expect(page.locator('.search-preview')).toContainText('搜索资料');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: '联网搜索', exact: true }).click();
  await expect(page.getByRole('button', { name: '联网搜索', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('textbox', { name: '发送消息' }).fill('联网搜索资料');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('联网搜索已完成');
  await page.locator('.web-sources summary').click();
  await expect(page.locator('.web-sources')).toContainText('搜索摘要');
  await expect(page.locator('.web-sources a')).toHaveAttribute(
    'href',
    'https://example.com/research',
  );
  await page.screenshot({ path: 'test-results/web-search.png', fullPage: true });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('显示模式').selectOption(theme);
    for (const width of [1024, 736, 375, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    }
  }
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天，我们一起完成什么？' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: 'test-results/mobile-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.screenshot({ path: 'test-results/home-light.png', fullPage: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.screenshot({ path: 'test-results/home-dark.png', fullPage: true });
  await page.getByLabel('工作模式').selectOption('task');
  await page.getByRole('textbox', { name: '发送消息' }).fill('慢任务，请整理资料');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/进行中/);
  await page.getByRole('button', { name: '暂停任务', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/已暂停/);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/已完成/, { timeout: 20000 });
  expect(errors).toEqual([]);
});
