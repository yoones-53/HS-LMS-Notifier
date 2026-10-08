import { app, dialog, Menu, nativeImage, shell, Tray, type BrowserWindow } from 'electron';
import { isAbsolute, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { runtimePaths, cliPaths, routePath, resolveRuntimePaths } from '../runtime/paths.js';
import { physicalDesktopRoot } from '../runtime/windows-root.js';
import { DataFileError } from '../runtime/json.js';
import { assertSafeDiagnostics } from '../utils/security.js';
import { DesktopService, desktopError } from './service.js';
import { productionDependencies } from './production.js';
import { createDesktopWindow } from './window.js';
import { runScheduledCheck } from './scheduled.js';

app.setName('HS-LMS-Notifier');
const explicitUserData = app.commandLine.hasSwitch('user-data-dir');
if (!explicitUserData) app.setPath('userData', join(app.getPath('appData'), 'HS-LMS-Notifier'));
let startupError = false;
try {
  if (explicitUserData) {
    if (!isAbsolute(app.getPath('userData'))) throw new DataFileError();
  } else {
    const physical = physicalDesktopRoot();
    const existing = !app.isPackaged && existsSync(routePath(cliPaths())) ? resolveRuntimePaths().root : physical;
    app.setPath('userData', existing === app.getPath('userData') ? physical : existing);
  }
} catch { startupError = true; }
let window: BrowserWindow | undefined;
let service: DesktopService | undefined;
let tray: Tray | undefined;
let quitting = false;
let quittingPending = false;
const show = () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); };
const scheduledCheck = process.argv.includes('--scheduled-check');
if (scheduledCheck) {
  void app.whenReady().then(async () => {
    if (!app.isPackaged || startupError) return 1;
    return runScheduledCheck(runtimePaths(app.getPath('userData')));
  }).then(code => app.exit(code), () => app.exit(1));
} else if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', show);
  app.on('activate', show);
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    if (quittingPending) return;
    quittingPending = true;
    void (async () => { await service?.close(); quitting = true; tray?.destroy(); app.quit(); })().catch(() => {
      quitting = true; app.quit();
    });
  });
  void app.whenReady().then(async () => {
    const paths = runtimePaths(app.getPath('userData'));
    const legacy = app.isPackaged || explicitUserData ? paths : cliPaths();
    let initializationError: string | undefined;
    service = new DesktopService(paths, legacy, productionDependencies(async target => {
      if (target === 'help') { await shell.openExternal('https://support.discord.com/hc/ko/articles/228383668'); return; }
      const directory = target === 'logs' ? paths.logs : paths.root;
      mkdirSync(directory, { recursive: true });
      if (await shell.openPath(directory)) throw new Error('OPEN_FAILED');
    }));
    try { if (startupError) throw new DataFileError(); assertSafeDiagnostics(); await service.initialize(); service.startTimer(); }
    catch (error) { initializationError = desktopError(error); }
    window = await createDesktopWindow(input => service!.handle(input), process.argv.includes('--dev'));
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'q') { event.preventDefault(); app.quit(); }
    });
    window.on('close', event => {
      if (quitting) return;
      event.preventDefault(); window?.hide();
      try { if (service?.trayHint()) tray?.displayBalloon({ title: '트레이에서 계속 실행됩니다',
        content: '창을 닫아도 실행은 유지됩니다. 완전히 종료하려면 트레이 메뉴에서 종료를 선택하세요.', iconType: 'info' }); } catch { /* no unsafe exception text */ }
    });
    // Small code-native icon, no runtime file or remote image dependency.
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4; const letter = x >= 8 && x <= 12 && y >= 7 && y <= 25
        || x >= 20 && x <= 24 && y >= 7 && y <= 25 || y >= 14 && y <= 18 && x >= 8 && x <= 24;
      pixels[i] = letter ? 255 : 134; pixels[i + 1] = letter ? 255 : 113; pixels[i + 2] = letter ? 255 : 18; pixels[i + 3] = 255;
    }
    tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }));
    tray.setToolTip('한신 LMS 알리미');
    const menu = (status: string) => Menu.buildFromTemplate([
      { label: '한신 LMS 알리미', enabled: false }, { label: `상태: ${status}`, enabled: false }, { type: 'separator' },
      { label: '지금 확인', click: () => { show(); void service?.handle({ method: 'runCheck' }); } },
      { label: '창 열기', click: show }, { label: '설정', click: () => { show(); void window?.webContents.executeJavaScript("location.hash = 'settings'"); } },
      { type: 'separator' }, { label: '종료', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu(initializationError ? '준비 확인 필요' : '대기 중'));
    tray.on('double-click', show);
    const statusTimer = setInterval(() => {
      void service?.status().then(state => tray?.setContextMenu(menu(state.busy ? '확인 중' : state.recent[0]?.result.title ?? '대기 중'))).catch(() => {});
    }, 15_000);
    app.once('will-quit', () => clearInterval(statusTimer));
    if (initializationError) await dialog.showMessageBox(window, { type: 'warning', title: '데이터를 확인해 주세요', message: initializationError,
      detail: '기존 데이터와 예약 작업은 보존했습니다. 다른 실행이 진행 중이면 종료 후 앱을 다시 열어 주세요.' });
  }).catch(() => { void dialog.showMessageBox({ type: 'error', message: '앱을 시작하지 못했습니다. 개발 실행 환경을 확인해 주세요.' }).then(() => app.quit()); });
}
