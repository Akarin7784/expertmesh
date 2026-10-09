import { test, expect, type Page } from '@playwright/test';
async function select(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.locator(`[role=option][data-value="${value}"]`).click();
}
test('onboarding, uploads, real API roundtrip, projects, assistants and responsive themes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天，我们一起完成什么？' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: '发送消息' });
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await editor.fill(
    Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 行：整理研究资料与主要观点。`).join('\n'),
  );
  await expect.poll(() => editor.evaluate((e) => e.clientHeight)).toBe(264);
  await expect(editor).toHaveCSS('resize', 'none');
  await page.screenshot({ path: 'test-results/composer-writing.png', fullPage: true });
  await editor.fill('请整理研究资料');
  await editor.press('Shift+Enter');
  await expect(editor).toHaveValue('请整理研究资料\n');
  await expect.poll(() => editor.evaluate((e) => e.clientHeight)).toBeLessThan(264);
  await editor.fill('');
  await page.getByRole('button', { name: '连接模型' }).click();
  const supplier = page.getByLabel('服务商', { exact: true });
  await supplier.focus();
  await supplier.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.screenshot({ path: 'test-results/select-light.png' });
  await supplier.press('End');
  await supplier.press('Enter');
  await expect(supplier).toContainText('兼容');
  await supplier.click();
  await supplier.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByLabel('连接名称').fill('测试服务');
  await page.getByLabel('API Key', { exact: false }).fill('test-secret');
  await page.getByLabel('服务地址').fill('http://127.0.0.1:3901/v1');
  await page.getByLabel('允许本地或内网服务').check();
  await page.getByLabel('模型 ID 1', { exact: true }).fill('fixture-model');
  await page.getByLabel('模型显示名称 1', { exact: true }).fill('测试模型');
  await page.getByRole('button', { name: '保存连接' }).click();
  await expect(page.getByLabel('选择模型')).toHaveText(/测试模型/);
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称').fill('产品资料');
  await page.getByLabel('项目说明').fill('比较主流产品的体验');
  await page.getByRole('button', { name: '保存项目' }).click();
  await page.getByRole('button', { name: '开始对话', exact: true }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('上传资料', { exact: true }).setInputFiles({
    name: '需求.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 需求\n这是用户上传的资料。'),
  });
  await expect(page.locator('.attachments')).toContainText('需求.md');
  await page.getByRole('textbox', { name: '发送消息' }).fill('请协作整理资料，生成报告');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/已完成/, { timeout: 20000 });
  await expect(page.locator('.markdown')).toContainText('协作已完成');
  await page.locator('.execution-details summary').click();
  await expect(page.locator('.execution-details')).toContainText('费用未提供');
  await page.locator('.contract-details summary').click();
  await expect(page.locator('.contract-details')).toContainText('已采用');
  await page.screenshot({ path: 'test-results/contracts.png', fullPage: true });
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
  await page.screenshot({ path: 'test-results/settings-book-models.png', fullPage: true });
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('连接成功，已获取模型列表')).toBeVisible();
  await page.getByRole('tab', { name: '联网搜索', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '测试连接', exact: true })).toHaveCount(0);
  await select(page, '搜索服务', 'searxng');
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
  await page.getByRole('tab', { name: '阅读与外观', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await select(page, '显示模式', theme);
    await page.getByLabel('显示模式').click();
    await page.screenshot({ path: `test-results/select-${theme}-settings.png` });
    await page.getByLabel('显示模式').press('Escape');

    for (const width of [1024, 736, 375, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.getByLabel('显示模式').click();
      const bounds = await page.getByRole('listbox').boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.getByLabel('显示模式').press('Escape');
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
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByRole('textbox', { name: '发送消息' }).fill('慢任务，请整理资料');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/进行中/);
  await page.getByRole('button', { name: '暂停任务', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/已暂停/);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.locator('.task-card .status')).toHaveText(/已完成/, { timeout: 20000 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.screenshot({ path: 'test-results/reading-conversation.png', fullPage: true });
  for (const [label, slug] of [
    ['任务', 'tasks'],
    ['项目', 'projects'],
    ['助手', 'assistants'],
    ['文件', 'files'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('.page-title')).toBeVisible();
    await page.screenshot({ path: `test-results/reading-${slug}.png`, fullPage: true });
    await page.setViewportSize({ width: 375, height: 850 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `test-results/reading-${slug}-mobile.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  expect(errors).toEqual([]);
});

test('sourced memory candidates, correction history, revoke and explicit message capture', async ({
  page,
}) => {
  await page.goto('/');
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  if (!bootstrap.connections.length) {
    const r = await page.request.post('/api/connections', {
      data: {
        provider: 'compatible',
        name: '记忆测试',
        baseUrl: 'http://127.0.0.1:3901/v1',
        apiKey: 'test',
        allowLocal: true,
        models: [{ id: 'fixture-model', name: '记忆模型', tools: true }],
      },
    });
    expect(r.ok()).toBe(true);
    await page.reload();
  }
  await page
    .getByRole('textbox', { name: '发送消息' })
    .fill('我的长期偏好：回答先给结论，请记住。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.memory-notice')).toContainText('1 条记忆等待确认', {
    timeout: 15000,
  });
  await page.getByRole('button', { name: '查看记忆', exact: true }).click();
  await page.getByRole('dialog').locator('summary').filter({ hasText: '记忆 ·' }).click();
  const entry = page.locator('.memory-entry');
  await expect(entry).toContainText('待确认');
  await entry.locator('summary').filter({ hasText: '为什么记住' }).click();
  await expect(entry.locator('blockquote')).toHaveText('回答先给结论');
  await entry.getByRole('button', { name: '查看原文', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.user-bubble')).toContainText('长期偏好');
  await page.getByRole('button', { name: '查看记忆', exact: true }).click();
  await page.getByRole('dialog').locator('summary').filter({ hasText: '记忆 ·' }).click();
  await entry.getByRole('button', { name: '确认记住', exact: true }).click();
  await expect(entry).toContainText('已生效');
  await entry.getByRole('button', { name: '更正', exact: true }).click();
  await page.getByLabel('更正后的内容').fill('回答先给背景，再给结论');
  await page.getByLabel('更正原因').fill('当前写作需要更充分的背景');
  await page.getByRole('button', { name: '保存更正', exact: true }).click();
  await expect(entry.locator(':scope > p').first()).toHaveText('回答先给背景，再给结论');
  await entry.locator('summary').filter({ hasText: '修改历史' }).click();
  await expect(entry.locator('.memory-history')).toContainText('回答先给结论');
  await page.screenshot({ path: 'test-results/memory-history.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 850 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/memory-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await entry.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(entry).toHaveCount(0);
  await select(page, '记忆状态', 'all');
  await expect(entry).toContainText('已撤销');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.user-actions').getByRole('button', { name: '记住', exact: true }).click();
  await page.getByLabel('要记住的内容').fill('用户希望回答先给结论');
  await page.getByLabel('为什么记住').fill('明确保存原始偏好');
  await page.getByRole('button', { name: '确认记住', exact: true }).click();
  await expect(page.getByText('记忆已保存，可在助手设置中更正或撤销')).toBeVisible();
  const records = await (
    await page.request.get('/api/memories?assistantId=general&projectId=')
  ).json();
  expect(records.filter((m: any) => m.status === 'active')).toHaveLength(1);
  expect(records.find((m: any) => m.status === 'active').sources[0].type).toBe('message');
});

test('read-only MCP connection, scoped grants, runtime calls and revocation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '工具与权限', exact: true }).click();
  await page.getByRole('button', { name: '添加工具连接', exact: true }).click();
  await page.getByLabel('工具连接名称').fill('研究资料工具');
  await page.getByRole('tab', { name: '联网搜索', exact: true }).click();
  await expect(page.getByLabel('工具连接名称')).not.toBeVisible();
  await page.getByRole('tab', { name: '联网搜索', exact: true }).press('ArrowUp');
  await expect(page.getByRole('tab', { name: '工具与权限', exact: true })).toBeFocused();
  await expect(page.getByLabel('工具连接名称')).toHaveValue('研究资料工具');
  await page.getByLabel('工具服务地址').fill('http://127.0.0.1:3901/mcp');
  await page.getByLabel('访问令牌（可选）').fill('mcp-test-secret');
  await page.getByLabel('允许本地或内网工具服务').check();
  await page.getByRole('button', { name: '保存工具连接', exact: true }).click();
  await page.getByRole('button', { name: '测试工具连接', exact: true }).click();
  await expect(page.getByText('连接测试通过', { exact: true })).toBeVisible();
  await expect(page.getByLabel('delete_notes 删除笔记')).toHaveCount(0);
  const readonly = page.locator('.tool-option').filter({ hasText: 'fetch_notes' }).locator('input');
  const write = page.locator('.tool-option').filter({ hasText: 'delete_notes' }).locator('input');
  await expect(write).toBeDisabled();
  await readonly.check();
  await page.getByLabel('我已确认所选工具只读取资料').check();
  await page.getByRole('button', { name: '保存工具授权', exact: true }).click();
  await expect(page.getByText('工具授权已保存', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/mcp-settings.png', fullPage: true });
  const exported = await (await page.request.get('/api/export')).text();
  expect(exported).not.toContain('mcp-test-secret');
  expect(exported).not.toContain('encryptedKey');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByRole('textbox', { name: '发送消息' }).fill('请使用工具资料整理研究摘要');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('可信工具资料', { timeout: 15000 });
  await expect(page.locator('.task-card .status')).toHaveText(/已完成/);
  await page.locator('.execution-details summary').click();
  await expect(page.locator('.execution-details')).toContainText('研究资料工具 · fetch_notes');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '工具与权限', exact: true }).click();
  await readonly.uncheck();
  await page.getByLabel('我已确认所选工具只读取资料').check();
  await page.getByRole('button', { name: '保存工具授权', exact: true }).click();
  await expect(page.getByText('工具授权已保存', { exact: true })).toBeVisible();
  const grants = await (
    await page.request.get('/api/tool-grants?assistantId=general&projectId=')
  ).json();
  expect(grants[0].tools).toHaveLength(0);
  await page.setViewportSize({ width: 375, height: 850 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: 'test-results/mcp-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
