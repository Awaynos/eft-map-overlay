// EFT Map Overlay — основное приложение Electron
// Прозрачное окно без рамок, поверх окна игры Escape from Tarkov,
// показывает интерактивную карту eft.su.
// НЕ читает память игры — это обычное окно поверх всех окон (безопасно для BattlEye).

const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

const APP_NAME = 'EFT Map Overlay';
const GITHUB_REPO = 'Awaynos/eft-map-overlay';

const MAPS = [
  { slug: 'factory',              name: 'Завод' },
  { slug: 'customs',              name: 'Таможня' },
  { slug: 'woods',                name: 'Лес' },
  { slug: 'lighthouse',           name: 'Маяк' },
  { slug: 'shoreline',            name: 'Берег' },
  { slug: 'reserve',              name: 'Резерв' },
  { slug: 'interchange',          name: 'Развязка' },
  { slug: 'streets-of-tarkov',    name: 'Улицы Таркова' },
  { slug: 'the-lab',              name: 'Лаборатория' },
  { slug: 'ground-zero',          name: 'Эпицентр' },
  { slug: 'the-labyrinth',        name: 'Лабиринт' },
  { slug: 'icebreaker',           name: 'Ледокол' },
];

let win = null;
let tray = null;
let isFirstLaunch = true;

// Плавная анимация прозрачности окна (без резких появлений)
function animateOpacity(targetWin, from, to, durationMs) {
  return new Promise((resolve) => {
    if (!targetWin || targetWin.isDestroyed()) { resolve(); return; }
    const start = Date.now();
    const tick = () => {
      if (!targetWin || targetWin.isDestroyed()) { resolve(); return; }
      const p = Math.min(1, (Date.now() - start) / durationMs);
      const eased = p * p * (3 - 2 * p); // smoothstep
      const val = from + (to - from) * eased;
      try { targetWin.setOpacity(Math.max(0, Math.min(1, val))); } catch (_) {}
      if (p < 1) { setTimeout(tick, 16); } else { resolve(); }
    };
    tick();
  });
}

// Сплэш-экран: start.png по центру монитора, плавно появляется и исчезает
function showSplash() {
  return new Promise((resolve) => {
    const imgPath = path.join(__dirname, 'assets', 'start.png');
    let img = null;
    try { img = nativeImage.createFromPath(imgPath); } catch (_) {}
    if (!img || img.isEmpty()) { resolve(); return; }

    let s = img.getSize();
    const wa = screen.getPrimaryDisplay().workArea;

    // Масштабируем, чтобы картинка целиком помещалась на экран
    const maxW = Math.round(wa.width * 0.75);
    const maxH = Math.round(wa.height * 0.75);
    const ratio = Math.min(1, maxW / s.width, maxH / s.height);
    const w = Math.round(s.width * ratio);
    const h = Math.round(s.height * ratio);

    const x = Math.round(wa.x + (wa.width - w) / 2);
    const y = Math.round(wa.y + (wa.height - h) / 2);

    const splash = new BrowserWindow({
      x, y,
      width: w,
      height: h,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    splash.setAlwaysOnTop(true, 'screen-saver');
    splash.setVisibleOnAllWorkspaces(true);
    splash.setIgnoreMouseEvents(true, { forward: true });
    splash.setOpacity(0);
    splash.loadFile(path.join(__dirname, 'assets', 'splash.html')).then(() => {
      splash.show();
      // плавное появление
      animateOpacity(splash, 0, 1, 450).then(() => {
        // подержать
        setTimeout(() => {
          animateOpacity(splash, 1, 0, 450).then(() => {
            if (!splash.isDestroyed()) splash.destroy();
            resolve();
          });
        }, 1400);
      });
    }).catch(() => { if (!splash.isDestroyed()) splash.destroy(); resolve(); });
  });
}

// Плавное появление главного окна после сплэша
function fadeInMainWindow() {
  if (!win || win.isDestroyed()) return Promise.resolve();
  if (!win.isVisible()) win.show();
  return animateOpacity(win, 0, state.opacity, 600);
}

const state = {
  visible: true,
  clickThrough: true,   // клики проходят в игру
  opacity: 0.85,
  mapIndex: 1,          // Таможня
  toolbarCollapsed: false, // меню карты/прозрачность свёрнуто
};

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (c) {
      if (typeof c.opacity === 'number') state.opacity = c.opacity;
      if (typeof c.mapIndex === 'number') state.mapIndex = c.mapIndex;
      if (typeof c.toolbarCollapsed === 'boolean') state.toolbarCollapsed = c.toolbarCollapsed;
      if (Array.isArray(c.bounds) && c.bounds.length === 4) state.bounds = c.bounds;
    }
  } catch (_) { /* нет конфига */ }
}

function saveConfig() {
  try {
    const c = { opacity: state.opacity, mapIndex: state.mapIndex, toolbarCollapsed: state.toolbarCollapsed };
    if (win) c.bounds = win.getBounds();
    fs.writeFileSync(configPath(), JSON.stringify(c));
  } catch (e) { console.error(e); }
}

function sendState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state-changed', { ...state });
}

function currentMap() { return MAPS[state.mapIndex]; }
function mapUrl(slug) { return `https://eft.su/m/${slug}`; }

function applyClickThrough() {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(state.clickThrough, { forward: true });
}

// Горячая зона: при наведении на тулбар/плашку окно временно кликабельно,
// иначе клики проходят в игру. Срабатывает только в режиме "клики в игру".
// Реализовано надёжно: main-процесс сам следит за курсором через screen.
let hotzoneTimer = null;

function startHotzoneTimer() {
  if (hotzoneTimer) clearInterval(hotzoneTimer);
  hotzoneTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible() || !state.clickThrough) return;
    try {
      const pt = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const pad = 6;
      // Развёрнутая панель примерно ~250x260 в левом верхнем углу окна,
      // свёрнутая — плашка 40x40.
      const zw = state.toolbarCollapsed ? 52 : 270;
      const zh = state.toolbarCollapsed ? 52 : 320;
      const inZone = pt.x >= b.x + pad && pt.x <= b.x + pad + zw &&
                     pt.y >= b.y + pad && pt.y <= b.y + pad + zh;
      const shouldIgnore = !inZone;
      if (win.isIgnoringMouseEvents() !== shouldIgnore) {
        win.setIgnoreMouseEvents(shouldIgnore, { forward: true });
      }
    } catch (_) { /* окно в процессе перестроения */ }
  }, 40);
}

function stopHotzoneTimer() {
  if (hotzoneTimer) { clearInterval(hotzoneTimer); hotzoneTimer = null; }
}

function setOpacity(v) {
  state.opacity = Math.min(1, Math.max(0.15, v));
  if (win && !win.isDestroyed()) win.setOpacity(state.opacity);
  sendState(); saveConfig();
}

function toggleClickThrough() {
  state.clickThrough = !state.clickThrough;
  applyClickThrough();
  if (!state.clickThrough) injectToolbar();
  // При ручном переключении на "клики в игру" зона автоматически пересчитывается таймером
  sendState(); saveConfig();
}

function navigate(slug) {
  if (!win || win.isDestroyed()) return;
  const idx = MAPS.findIndex((m) => m.slug === slug);
  if (idx >= 0) state.mapIndex = idx;
  // При смене карты разворачиваем меню обратно, чтобы не потерять управление
  state.toolbarCollapsed = false;
  win.loadURL(mapUrl(slug));
  sendState(); saveConfig();
}

function setToolbarCollapsed(collapsed) {
  state.toolbarCollapsed = !!collapsed;
  // Сообщаем странице, чтобы она обновила тулбар (для уже загруженной страницы)
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    win.webContents.executeJavaScript(
      `window.__eftToolbarCollapsed = ${state.toolbarCollapsed}; ` +
      `document.dispatchEvent(new CustomEvent('eft-overlay-state', { detail: ${JSON.stringify(state)} }));`
    ).catch(() => {});
  }
  sendState(); saveConfig();
}

function showOverlay() {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  win.focus();
  state.visible = true;
  sendState();
}

function hideOverlay() {
  if (!win || win.isDestroyed()) return;
  win.hide();
  state.visible = false;
  sendState();
}

function toggleVisible() {
  state.visible ? hideOverlay() : showOverlay();
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const b = state.bounds || {
    x: Math.round(wa.x + wa.width - 520 - 24),
    y: Math.round(wa.y + 24),
    width: 520,
    height: 720,
  };

  win = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    fullscreenable: false,
    hasShadow: false,
    title: APP_NAME,
    show: false, // окно появляется плавно после сплэша
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setMenu(null);
  win.setAlwaysOnTop(true, 'screen-saver'); // поверх полноэкранных окон игры
  win.setVisibleOnAllWorkspaces(true);
  win.setOpacity(0); // переход от сплэша будет плавным
  applyClickThrough();

  win.loadURL(mapUrl(currentMap().slug));

  // Поддержание поверх всех окон после переключений
  const keepTop = () => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver'); };
  win.on('focus', keepTop);
  win.on('show', keepTop);

  win.on('close', () => { saveConfig(); });

  win.webContents.on('did-finish-load', () => {
    if (process.env.SMOKE_TEST) console.log('[SMOKE] did-finish-load:', win.webContents.getURL());
    (async () => {
      await win.webContents.executeJavaScript(`window.__eftMapSlug = '${currentMap().slug}'; window.__eftToolbarCollapsed = ${state.toolbarCollapsed};`).catch(() => {});
      await injectCleanup();
      await injectToolbar();
      sendState();
      // Плавное появление после сплэша (только первый раз)
      if (isFirstLaunch) {
        isFirstLaunch = false;
        await fadeInMainWindow();
      } else {
        win.setOpacity(state.opacity);
      }
    })();
  });
  win.webContents.on('render-process-gone', () => { /* приложение живёт дальше */ });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // внешние ссылки открываем в браузере, не в оверлее
    const { shell } = require('electron');
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Тулбар оверлея собирается из файла-шаблона (placeholder'ы подставляются здесь)
function buildToolbarJS() {
  const tpl = fs.readFileSync(path.join(__dirname, 'toolbar_payload.js'), 'utf8');
  const options = MAPS.map((m) => '<option value="' + m.slug + '">' + m.name + '</option>').join('');
  return tpl.split('__APP_NAME__').join(APP_NAME).split('__MAP_OPTIONS__').join(options);
}

// Инжектит тулбар в страницу eft.su
async function injectToolbar() {
  try { await win.webContents.executeJavaScript(buildToolbarJS(), true); } catch (e) { /* страница могла смениться */ }
}

// Скрывает "лишний" интерфейс сайта eft.su поверх карты
function injectCleanup() {
  try {
    const js = fs.readFileSync(path.join(__dirname, 'cleanup.js'), 'utf8');
    win.webContents.executeJavaScript(js, true).catch(() => {});
  } catch (e) { /* ignore */ }
}

// ----- IPC из прелоада -----
ipcMain.on('set-map', (_e, slug) => navigate(slug));
ipcMain.on('set-opacity', (_e, v) => setOpacity(v));
ipcMain.on('toggle-clickthrough', () => toggleClickThrough());
ipcMain.on('hide', () => hideOverlay());
ipcMain.on('quit', () => app.quit());
ipcMain.on('set-toolbar-collapsed', (_e, v) => setToolbarCollapsed(v));
ipcMain.on('open-external', () => {
  const { shell } = require('electron');
  shell.openExternal(mapUrl(currentMap().slug));
});
ipcMain.on('check-update', async (e) => {
  const result = await checkForUpdate();
  if (!e.sender.isDestroyed()) e.sender.send('update-status', result);
});
ipcMain.on('apply-update', async (e) => {
  const result = await applyUpdate();
  if (!e.sender.isDestroyed()) e.sender.send('update-status', result);
});

// ----- Автообновление (по образцу tg-ws-proxy: GitHub Releases API) -----
const LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const userDataPath = () => app.getPath('userData');
const updateCacheFile = () => path.join(userDataPath(), 'update-cache.json');

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': `${APP_NAME}-updater`,
      },
      timeout: 12000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpGetJson(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout')); });
  });
}

function parseVersion(v) {
  const s = String(v || '').trim().replace(/^[vV]/, '');
  return s.split('.').map((n) => parseInt(n, 10) || 0);
}
function versionGreater(a, b) {
  const ta = parseVersion(a), tb = parseVersion(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i] || 0, y = tb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function checkForUpdate() {
  const base = { repo: GITHUB_REPO, latest: null, url: null, hasUpdate: false, current: app.getVersion() };
  try {
    const rel = await httpGetJson(LATEST_API);
    const tag = (rel.tag_name || '').trim();
    base.latest = tag;
    base.url = rel.html_url || `https://github.com/${GITHUB_REPO}/releases`;
    base.hasUpdate = !!tag && versionGreater(tag, app.getVersion());
    base.assets = (rel.assets || []).filter((a) => /\.exe$/i.test(a.name))
      .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    return { ok: true, ...base };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err), ...base };
  }
}

async function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const handler = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = https.get(res.headers.location, { headers: { 'User-Agent': `${APP_NAME}-updater` } }, handler);
        next.on('error', reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let done = 0;
      res.on('data', (c) => { done += c.length; if (onProgress && total) onProgress(done / total); });
      res.pipe(out);
    };
    out.on('finish', () => { out.close(() => resolve(dest)); });
    out.on('error', reject);
    const req = https.get(url, { headers: { 'User-Agent': `${APP_NAME}-updater` } }, handler);
    req.on('error', reject);
  });
}

// Возвращает путь к portable exe (только если запущено из portable-сборки)
function portableExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || null;
}

async function applyUpdate() {
  const check = await checkForUpdate();
  if (!check.ok) return { ok: false, stage: 'check', message: check.error };
  if (!check.hasUpdate) return { ok: false, stage: 'none', message: 'У вас уже последняя версия' };
  const exe = check.assets && check.assets.find((a) => /portable/i.test(a.name));
  if (!exe) return { ok: false, stage: 'asset', message: 'Файл обновления не найден в релизе' };

  const target = portableExePath();
  if (!target) return { ok: false, stage: 'portable', message: 'Обновление доступно только в portable-версии' };

  const tmpDir = path.join(app.getPath('temp'), `${APP_NAME.replace(/\s/g,'_')}-update`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpExe = path.join(tmpDir, `update-${Date.now()}.exe`);
  const batFile = path.join(tmpDir, `run-update-${Date.now()}.bat`);

  try {
    await downloadFile(exe.url, tmpExe);
  } catch (err) {
    return { ok: false, stage: 'download', message: String(err && err.message || err) };
  }

  // bat: ждёт выхода, копирует новый exe поверх старого, запускает его, удаляет себя
  const bat = [
    '@echo off',
    'setlocal',
    'set SRC="' + tmpExe + '"',
    'set DST="' + target + '"',
    'set SELF="' + batFile + '"',
    ':wait',
    'tasklist /FI "IMAGENAME eq ' + target.split(/[\\/]/).pop() + '" 2>nul | find /I "' + target.split(/[\\/]/).pop() + '" >nul',
    'if not errorlevel 1 ( ping 127.0.0.1 -n 2 >nul & goto wait )',
    'copy /Y %SRC% %DST% >nul',
    'if errorlevel 1 pause',
    'start "" %DST%',
    'del /F /Q "%~f0"',
  ].join('\r\n');
  fs.writeFileSync(batFile, bat, 'utf8');

  const p = spawn('cmd.exe', ['/c', batFile], { detached: true, stdio: 'ignore', windowsHide: true });
  p.unref();

  // закрыть приложение — bat подхватит после выхода
  setTimeout(() => { app.quit(); }, 300);
  return { ok: true, stage: 'applying' };
}

// ----- Горячие клавиши -----
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const reg = (acc, fn) => {
    try {
      const p = globalShortcut.register(acc, fn);
      if (p && typeof p.then === 'function') p.catch((e) => console.warn('Hotkey failed:', acc, e));
    } catch (e) { console.warn('Hotkey failed:', acc, e); }
  };
  reg('CommandOrControl+Shift+M', toggleClickThrough);
  reg('CommandOrControl+Shift+H', toggleVisible);
  reg('CommandOrControl+Shift+Q', () => app.quit());
  reg('CommandOrControl+Shift+C', () => setToolbarCollapsed(!state.toolbarCollapsed));
  reg('CommandOrControl+Shift+PageUp', () => setOpacity(state.opacity + 0.05));
  reg('CommandOrControl+Shift+PageDown', () => setOpacity(state.opacity - 0.05));
  // Ctrl+Shift+1..0 — быстрый выбор карты (0 = 10-я)
  for (let i = 0; i < Math.min(10, MAPS.length); i++) {
    reg('CommandOrControl+Shift+' + ((i + 1) % 10), (() => { const idx = i; return () => navigate(MAPS[idx].slug); })());
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let img;
  try { img = nativeImage.createFromPath(iconPath); } catch (_) {}
  if (!img || img.isEmpty()) {
    // fallback: маленькая иконка из dataURL
    img = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR42mNk+M9Qz0AEYBxVinHUwhFLRyyMsXBUwuEEqHlgYGBgAA4AAn0lB7gAAAAASUVORK5CYII='
    );
  }
  tray = new Tray(img);
  tray.setToolTip(APP_NAME);
  const menu = Menu.buildFromTemplate([
    { label: 'Показать / скрыть', click: toggleVisible },
    { type: 'separator' },
    { label: 'Клики сквозь окно', type: 'checkbox', checked: state.clickThrough, click: () => toggleClickThrough() },
    { label: 'Прозрачность +', click: () => setOpacity(state.opacity + 0.05) },
    { label: 'Прозрачность -', click: () => setOpacity(state.opacity - 0.05) },
    { type: 'separator' },
    { label: 'Карты', submenu: MAPS.map((m) => ({ label: m.name, type: 'radio', checked: m.slug === currentMap().slug, click: () => navigate(m.slug) })) },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', toggleVisible);
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  loadConfig();
  // Сначала плавный сплэш-экран, затем плавное появление карты
  await showSplash();
  createWindow();
  createTray();
  registerHotkeys();
  startHotzoneTimer();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); stopHotzoneTimer(); saveConfig(); });
app.on('window-all-closed', () => { /* держим в трее, не выходим */ });

// Код для прелоада упомянут здесь только для сборки тулбара
module.exports = { APP_NAME, MAPS };