import { BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { Reply } from './contracts.js';
import { isTrustedSender } from './ipc-policy.js';

export const CHANNEL = 'hs-lms:request';
export async function createDesktopWindow(handle: (input: unknown) => Promise<Reply>, developer = false): Promise<BrowserWindow> {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const expected = pathToFileURL(join(directory, 'index.html')).href;
  const window = new BrowserWindow({ width: 1060, height: 800, minWidth: 760, minHeight: 650, show: false,
    title: '한신 LMS 알리미', backgroundColor: '#f4f6fa', autoHideMenuBar: true,
    webPreferences: { preload: join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false, devTools: developer, spellcheck: false } });
  window.removeMenu();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  ipcMain.handle(CHANNEL, (event, input: unknown) => {
    if (!isTrustedSender(event.sender.id, window.webContents.id, event.senderFrame === window.webContents.mainFrame,
      event.senderFrame?.url ?? '', expected)) return { ok: false, message: '허용되지 않은 화면 요청입니다.' };
    return handle(input).catch(() => ({ ok: false, message: '작업을 완료하지 못했습니다.' }));
  });
  window.once('closed', () => ipcMain.removeHandler(CHANNEL));
  await window.loadFile(join(directory, 'index.html'));
  window.show();
  return window;
}
