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
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '执行与工作区', exact: true }).click();
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
    await desktop.close();
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
