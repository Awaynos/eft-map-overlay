// EFT Map Overlay — основное приложение Electron
// Прозрачное окно без рамок, поверх окна игры Escape from Tarkov,
// показывает интерактивную карту eft.su.
// НЕ читает память игры — это обычное окно поверх всех окон (безопасно для BattlEye).

const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'EFT Map Overlay';

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
  win.setOpacity(state.opacity);
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

app.whenReady().then(() => {
  app.setName(APP_NAME);
  loadConfig();
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