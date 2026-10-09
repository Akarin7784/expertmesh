import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
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
  await expect.poll(() => editor.evaluate((e) => e.clientHeight)).toBeGreaterThan(96);
  expect(await editor.evaluate((e) => e.clientHeight)).toBeLessThanOrEqual(264);
  expect(await editor.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
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
  await page.getByRole('button', { name: '获取可用模型', exact: true }).click();
  await expect(page.getByText('已获取 2 个模型', { exact: true })).toBeVisible();
  await page.getByLabel('搜索可用模型', { exact: true }).fill('fixture-model');
  await page.getByLabel('选择模型 fixture-model', { exact: true }).check();
  await page.getByRole('button', { name: '添加所选模型', exact: false }).click();
  await expect(page.getByLabel('模型 ID 1', { exact: true })).toHaveValue('fixture-model');
  await page.locator('.model-row').getByRole('checkbox').check();
  await page.screenshot({ path: 'test-results/model-discovery.png', fullPage: true });
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
  await page.locator('.execution-details > summary').click();
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
  await page.getByRole('button', { name: '编辑服务 测试服务', exact: true }).click();
  await page.getByRole('button', { name: '获取可用模型', exact: true }).click();
  await expect(page.getByLabel('选择模型 fixture-model', { exact: true })).toBeDisabled();
  await page.getByLabel('选择模型 fixture-text', { exact: true }).check();
  await page.getByRole('button', { name: '添加所选模型', exact: false }).click();
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.locator('.model-tags')).toContainText('fixture-text');
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
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page
    .getByRole('textbox', { name: '发送消息' })
    .fill(
      Array.from({ length: 80 }, (_, i) => `阅读位置检查 ${i + 1}：这是一段较长的对话资料。`).join(
        '\n',
      ),
    );
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('整理完成', { timeout: 15000 });
  const inputBounds = await page.locator('.chat-dock').boundingBox();
  await page.locator('.chat-content').evaluate((area) => {
    area.scrollTop = 0;
    area.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: '回到最新', exact: true })).toBeVisible();
  // Polling model/task updates must preserve the reader's history position.
  await page.waitForTimeout(1200);
  expect(await page.locator('.chat-content').evaluate((area) => area.scrollTop)).toBe(0);
  expect((await page.locator('.chat-dock').boundingBox())!.y).toBe(inputBounds!.y);
  await page.screenshot({ path: 'test-results/chat-feed-desktop.png' });
  await page.getByRole('button', { name: '回到最新', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.chat-content')
        .evaluate((area) => area.scrollHeight - area.scrollTop - area.clientHeight),
    )
    .toBeLessThan(2);
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 850 });
    const dock = await page.locator('.chat-dock').boundingBox();
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(851);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await page.screenshot({ path: 'test-results/chat-feed-mobile.png', animations: 'disabled' });
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
  await page.locator('.execution-details > summary').click();
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

test('execution settings, scoped workspace preview and budget pause/resume', async ({ page }) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mesh-ui-workspace-'));
  writeFileSync(resolve(dir, 'acceptance.md'), '只读验收资料');
  writeFileSync(resolve(dir, '.env'), 'secret=must-not-appear');
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '执行与工作区', exact: true }).click();
    await page.getByLabel('模型调用次数', { exact: true }).fill('1');
    await page.getByRole('button', { name: '保存默认预算', exact: true }).click();
    await expect(page.getByText('新任务预算已保存', { exact: true })).toBeVisible();
    await page.getByLabel('目录名称', { exact: true }).fill('验收目录');
    await page.getByLabel('本地目录路径', { exact: true }).fill(dir);
    await page.getByRole('button', { name: '连接目录', exact: true }).click();
    const workspace = page.locator('.workspace-row').filter({ hasText: '验收目录' });
    await expect(workspace.getByRole('button', { name: '查看文件' })).toBeDisabled();
    await workspace.getByLabel('允许读取').check();
    await workspace.getByRole('button', { name: '查看文件' }).click();
    await expect(workspace.locator('pre')).toContainText('acceptance.md');
    await expect(workspace.locator('pre')).not.toContainText('.env');
    const entries = await (await page.request.get('/api/workspaces')).json();
    const workspaceId = entries.find((w: any) => w.name === '验收目录').id;
    const readUrl = `/api/workspaces/${workspaceId}/read?path=acceptance.md&assistantId=general&projectId=`;
    expect((await (await page.request.get(readUrl)).json()).content).toBe('只读验收资料');
    expect((await page.request.get(readUrl.replace('acceptance.md', '.env'))).ok()).toBe(false);
    await page.screenshot({ path: 'test-results/execution-settings.png', fullPage: true });
    await page.setViewportSize({ width: 375, height: 850 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect
      .poll(() => page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().right))
      .toBeLessThanOrEqual(0);
    await page.screenshot({
      path: 'test-results/execution-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await page.getByRole('button', { name: '任务', exact: true }).click();
    await page.getByRole('button', { name: '新建任务', exact: true }).click();
    await page.getByRole('textbox', { name: '发送消息' }).fill('整理验收资料');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const card = page.locator('.task-card').filter({ hasText: '整理验收资料' }).first();
    await expect(card.locator('.status').first()).toHaveText(/已暂停/, { timeout: 15000 });
    await card.locator('.task-budget summary').click();
    await expect(card.locator('.task-budget')).toContainText('已达到模型调用预算');
    await card.getByRole('button', { name: '调整预算', exact: true }).click();
    await card.getByLabel('模型调用次数', { exact: true }).fill('24');
    await card.getByRole('button', { name: '保存任务预算', exact: true }).click();
    await expect(card.getByText('预算已更新，可以继续任务')).toBeVisible();
    await card.getByRole('button', { name: '继续', exact: true }).click();
    await expect(card.locator('.status').first()).toHaveText(/已完成/, { timeout: 15000 });
    await expect(card.locator('.task-budget summary')).toContainText('模型 3/24');
    await page.screenshot({ path: 'test-results/budget-resumed.png', fullPage: true });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '执行与工作区', exact: true }).click();
    await workspace.getByLabel('允许读取').uncheck();
    await expect(workspace.getByRole('button', { name: '查看文件' })).toBeDisabled();
    expect((await page.request.get(readUrl)).ok()).toBe(false);
    await workspace.getByRole('button', { name: '移除连接' }).click();
    await expect(workspace).toHaveCount(0);
    await page.getByLabel('模型调用次数', { exact: true }).fill('24');
    await page.getByRole('button', { name: '保存默认预算', exact: true }).click();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
