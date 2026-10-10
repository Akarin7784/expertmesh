import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

test('desktop runs its bundled backend, native directory picker, downloads and persistent data', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mesh-desktop-e2e-'));
  const dataDir = resolve(dir, 'data');
  const workspace = resolve(dir, 'workspace');
  mkdirSync(workspace);
  writeFileSync(resolve(workspace, 'notes.md'), '桌面工作区资料');
  let desktop: ElectronApplication | undefined;
  const launch = async () => {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    env.EXPERTMESH_DESKTOP_DATA_DIR = dataDir;
    env.EXPERTMESH_DESKTOP_USER_DATA_DIR = resolve(dir, 'profile');
    delete env.ELECTRON_RUN_AS_NODE;
    const executablePath = process.env.EXPERTMESH_DESKTOP_EXECUTABLE;
    return electron.launch({
      ...(executablePath ? { executablePath, args: [] } : { args: ['desktop-build/app'] }),
      env,
    });
  };
  try {
    desktop = await launch();
    let page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '今天，我们一起完成什么？' })).toBeVisible();
    const origin = new URL(page.url()).origin;
    expect((await fetch(`${origin}/api/bootstrap`)).status).toBe(403);
    expect(
      await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require),
    ).toBe('undefined');
    expect(
      await desktop.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as {
          getLastWebPreferences(): {
            sandbox: boolean;
            contextIsolation: boolean;
            nodeIntegration: boolean;
          };
        };
        const settings = contents.getLastWebPreferences();
        return {
          sandbox: settings.sandbox,
          contextIsolation: settings.contextIsolation,
          nodeIntegration: settings.nodeIntegration,
        };
      }),
    ).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    if (process.platform !== 'darwin')
      expect(await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBe(null);
    const windowStatus = () =>
      desktop!.evaluate(({ BrowserWindow }) => {
        const current = BrowserWindow.getAllWindows()[0];
        return { maximized: current.isMaximized(), minimized: current.isMinimized() };
      });
    await page.getByRole('button', { name: '最大化窗口', exact: true }).click();
    await expect.poll(async () => (await windowStatus()).maximized).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-window-state', 'maximized');
    await expect
      .poll(() =>
        page
          .locator('.app-shell')
          .evaluate((element) => getComputedStyle(element, '::after').opacity),
      )
      .toBe('0');
    await page.getByRole('button', { name: '还原窗口', exact: true }).click();
    await expect.poll(async () => (await windowStatus()).maximized).toBe(false);
    await expect(page.locator('html')).toHaveAttribute('data-window-state', 'normal');
    // OS focus transfer is unreliable under automation; exercise main-process events explicitly.
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('blur'));
    await expect(page.locator('html')).toHaveAttribute('data-window-focused', 'false');
    await expect
      .poll(() =>
        page
          .locator('.app-shell')
          .evaluate((element) => getComputedStyle(element, '::after').opacity),
      )
      .toBe('0.45');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('focus'));
    await expect(page.locator('html')).toHaveAttribute('data-window-focused', 'true');
    expect(
      await desktop.evaluate(({ BrowserWindow }) => {
        const current = BrowserWindow.getAllWindows()[0];
        return { shadow: current.hasShadow(), resizable: current.isResizable() };
      }),
    ).toEqual({ shadow: true, resizable: true });
    await page.getByRole('button', { name: '最小化窗口', exact: true }).click();
    await expect.poll(async () => (await windowStatus()).minimized).toBe(true);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    await expect.poll(async () => (await windowStatus()).minimized).toBe(false);
    // Window state changes outside the UI must update the restore/maximize icon too.
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await expect(page.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '还原窗口', exact: true }).click();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1100, 650),
    );
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => localStorage.setItem('em-theme', value), theme);
      await page.reload();
      await page.getByRole('button', { name: '助手', exact: true }).click();
      await expect(page.getByRole('heading', { name: '你的助手', exact: true })).toBeVisible();
      const content = page.locator('.content');
      await expect(content).toHaveCSS('scrollbar-width', 'none');
      expect(
        await content.evaluate(
          (element) => getComputedStyle(element, '::-webkit-scrollbar').display,
        ),
      ).toBe('none');
      await content.hover();
      await page.mouse.wheel(0, 650);
      await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(
        await page.locator('.topbar').evaluate((element) => element.getBoundingClientRect().top),
      ).toBe(0);
      expect(
        await page
          .locator('.topbar')
          .evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region')),
      ).toBe('drag');
      expect(
        await page
          .getByRole('button', { name: '关闭窗口', exact: true })
          .evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region')),
      ).toBe('no-drag');
      await content.evaluate((element) => {
        element.scrollTop = 0;
      });
      await content.focus();
      await content.press('PageDown');
      await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await content.press('Home');
      await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
      await page.getByRole('button', { name: '助手', exact: true }).focus();
      await page.screenshot({ path: `test-results/desktop-frameless-${theme}.png` });
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '执行与工作区', exact: true }).click();
    const pages = page.locator('.book-pages');
    const index = page.getByRole('navigation', { name: '设置目录' });
    for (const [width, height] of [
      [1320, 900],
      [1100, 650],
      [720, 540],
    ]) {
      await desktop.evaluate(
        ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
        [width, height],
      );
      await expect(pages).toHaveCSS('overflow-y', 'auto');
      await expect(pages).toHaveCSS('scrollbar-width', 'none');
      const before = await index.boundingBox();
      await pages.hover();
      await page.mouse.wheel(0, 700);
      await expect.poll(() => pages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await page.locator('.content').evaluate((element) => element.scrollTop)).toBe(0);
      expect((await index.boundingBox())!.y).toBeCloseTo(before!.y, 1);
      expect(await index.evaluate((element) => element.scrollTop)).toBe(0);
      const chapterPosition = await pages.evaluate((element) => element.scrollTop);
      await index.hover();
      await page.mouse.wheel(0, 700);
      expect(await pages.evaluate((element) => element.scrollTop)).toBe(chapterPosition);
      await page.getByRole('tab', { name: '阅读与外观', exact: true }).click();
      await expect.poll(() => pages.evaluate((element) => element.scrollTop)).toBe(0);
      await page.getByRole('tab', { name: '执行与工作区', exact: true }).click();
      await page.getByLabel('模型调用次数', { exact: true }).fill('7');
      await page.getByRole('tab', { name: '工具与权限', exact: true }).click();
      await page.getByRole('tab', { name: '执行与工作区', exact: true }).click();
      await expect(page.getByLabel('模型调用次数', { exact: true })).toHaveValue('7');
    }
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1320, 900),
    );
    await pages.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => pages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/desktop-settings-independent-scroll.png' });
    await pages.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(page.getByRole('button', { name: '选择目录', exact: true })).toBeVisible();
    // Stub only the OS dialog response; the button, preload bridge and validated IPC are real.
    await desktop.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, workspace);
    await page.getByRole('button', { name: '选择目录', exact: true }).click();
    await expect(page.getByLabel('本地目录路径', { exact: true })).toHaveValue(workspace);
    await page.getByLabel('目录名称', { exact: true }).fill('桌面验收目录');
    await page.getByRole('button', { name: '连接目录', exact: true }).click();
    const row = page.locator('.workspace-row').filter({ hasText: '桌面验收目录' });
    await expect(row.getByRole('button', { name: '查看文件' })).toBeDisabled();
    await row.getByLabel('允许读取').check();
    await row.getByRole('button', { name: '查看文件' }).click();
    await expect(row.locator('pre')).toContainText('notes.md');
    // Cancellation keeps the current input untouched.
    await desktop.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await page.getByLabel('本地目录路径', { exact: true }).fill(workspace);
    await page.getByRole('button', { name: '选择目录', exact: true }).click();
    await expect(page.getByLabel('本地目录路径', { exact: true })).toHaveValue(workspace);
    await page.getByLabel('模型调用次数', { exact: true }).fill('7');
    await page.getByRole('button', { name: '保存默认预算', exact: true }).click();
    await expect(page.getByText('新任务预算已保存', { exact: true })).toBeVisible();
    const downloadPath = resolve(dir, 'export.json');
    await desktop.evaluate(({ session }, path) => {
      session.fromPartition('expertmesh-desktop').once('will-download', (_event, item) => {
        item.setSavePath(path);
      });
    }, downloadPath);
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/api/export';
      link.download = 'expertmesh-export.json';
      link.click();
    });
    await expect.poll(() => existsSync(downloadPath)).toBe(true);
    expect(JSON.parse(readFileSync(downloadPath, 'utf8')).workspaces[0].name).toBe('桌面验收目录');
    await page.screenshot({ path: 'test-results/desktop-settings.png' });
    expect(errors).toEqual([]);
    const closed = desktop.waitForEvent('close');
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    if (process.platform === 'darwin') await desktop.close();
    await closed;
    desktop = undefined;
    await expect
      .poll(async () => {
        try {
          await fetch(`${origin}/api/health`);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
    expect(existsSync(resolve(dataDir, 'expertmesh.db'))).toBe(true);
    expect(existsSync(resolve(dataDir, 'secret.key'))).toBe(true);
    desktop = await launch();
    page = await desktop.firstWindow();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '执行与工作区', exact: true }).click();
    await expect(page.getByLabel('模型调用次数', { exact: true })).toHaveValue('7');
    await expect(page.locator('.workspace-row')).toContainText('桌面验收目录');
  } finally {
    await desktop?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
