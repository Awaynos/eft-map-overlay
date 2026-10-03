// Тулбар оверлея. Плейсхолдеры APP_NAME и MAP_OPTIONS заменяются в main.js.
(() => {
  const state = {
    collapsed: !!(window.__eftToolbarCollapsed),
  };

  const applyCollapsed = (collapsed) => {
    state.collapsed = collapsed;
    const panel = document.getElementById('eft-overlay-panel');
    const tab = document.getElementById('eft-overlay-tab');
    if (!panel || !tab) return;
    panel.style.display = collapsed ? 'none' : 'block';
    tab.style.display = collapsed ? 'flex' : 'none';
  };

  // --- Маленькая плашка в свёрнутом виде ---
  const tab = document.createElement('div');
  tab.id = 'eft-overlay-tab';
  tab.title = 'Меню свёрнуто — нажми, чтобы развернуть';
  tab.innerHTML = '<span style="font-size:18px;line-height:1">🗺</span>';
  const tabStyle = document.createElement('style');
  tabStyle.textContent = `
    #eft-overlay-tab {
      position: fixed; z-index: 2147483647; top: 8px; left: 8px;
      width: 40px; height: 40px; border-radius: 10px;
      background: rgba(10,10,14,.82); color: #eee;
      align-items: center; justify-content: center;
      box-shadow: 0 4px 18px rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.12);
      cursor: pointer; user-select: none;
      -webkit-app-region: no-drag;
    }
    #eft-overlay-tab:hover { background: rgba(30,30,38,.92); }
  `;
  tab.addEventListener('click', () => window.eftOverlay.setToolbarCollapsed(false));

  // --- Полная панель ---
  const panel = document.createElement('div');
  panel.id = 'eft-overlay-panel';
  panel.innerHTML = `
    <div class="eft-head">
      <div class="eft-title" title="Перетащи, чтобы переместить">__APP_NAME__</div>
      <button id="eft-collapse" class="eft-btn eft-mini" title="Свернуть меню">—</button>
    </div>
    <label class="eft-row">Карта:
      <select id="eft-map-select">__MAP_OPTIONS__</select>
    </label>
    <label class="eft-row">Прозрачность:
      <input id="eft-opacity" type="range" min="15" max="100" step="5" value="85">
    </label>
    <div class="eft-row eft-btns">
      <button id="eft-clicks" class="eft-btn">Клики: в игру</button>
      <button id="eft-hide" class="eft-btn">Скрыть</button>
      <button id="eft-external" class="eft-btn">В браузере</button>
      <button id="eft-quit" class="eft-btn eft-danger">Выход</button>
    </div>
    <div class="eft-hint">Ctrl+Shift+M — клики сквозь окно / по карте</div>
  `;
  const st = document.createElement('style');
  st.textContent = `
    #eft-overlay-panel {
      position: fixed; z-index: 2147483647; top: 8px; left: 8px;
      width: 250px; padding: 10px 12px; border-radius: 10px;
      background: rgba(10,10,14,.82); color: #eee; font: 13px/1.4 Arial, sans-serif;
      box-shadow: 0 4px 18px rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.12);
      -webkit-app-region: drag; user-select: none; backdrop-filter: blur(4px);
    }
    #eft-overlay-panel select, #eft-overlay-panel input { -webkit-app-region: no-drag; }
    .eft-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .eft-title { font-weight: bold; font-size: 12px; opacity: .85; letter-spacing: .4px; }
    .eft-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; -webkit-app-region: no-drag; }
    .eft-row select { flex: 1; background: #1c1c24; color: #eee; border: 1px solid #333; border-radius: 6px; padding: 3px 6px; font-size: 12px; }
    .eft-row input[type=range] { flex: 1; accent-color: #43b581; }
    .eft-btns { flex-wrap: wrap; }
    .eft-btn {
      -webkit-app-region: no-drag; background: #26262f; color: #eee; border: 1px solid #3a3a44;
      border-radius: 6px; padding: 5px 9px; font-size: 12px; cursor: pointer;
    }
    .eft-btn:hover { background: #34343f; }
    .eft-mini { padding: 1px 8px; font-size: 14px; }
    .eft-btn.eft-danger { color: #ff8a80; border-color: #ff8a8040; }
    .eft-hint { margin-top: 6px; font-size: 11px; opacity: .55; -webkit-app-region: no-drag; }
  `;
  document.head.appendChild(tabStyle);
  document.body.appendChild(tab);
  document.head.appendChild(st);
  document.body.appendChild(panel);

  const select = panel.querySelector('#eft-map-select');
  select.value = window.__eftMapSlug || 'customs';
  select.addEventListener('change', () => window.eftOverlay.setMap(select.value));

  const op = panel.querySelector('#eft-opacity');
  op.addEventListener('input', () => window.eftOverlay.setOpacity(op.value / 100));

  const clicksBtn = panel.querySelector('#eft-clicks');
  clicksBtn.addEventListener('click', () => window.eftOverlay.toggleClickThrough());
  panel.querySelector('#eft-collapse').addEventListener('click', () => window.eftOverlay.setToolbarCollapsed(true));
  panel.querySelector('#eft-hide').addEventListener('click', () => window.eftOverlay.hide());
  panel.querySelector('#eft-external').addEventListener('click', () => window.eftOverlay.openExternal());
  panel.querySelector('#eft-quit').addEventListener('click', () => window.eftOverlay.quit());

  // Синхронизация состояния из главного процесса
  window.eftOverlay.onStateChange((s) => {
    clicksBtn.textContent = 'Клики: ' + (s.clickThrough ? 'в игру' : 'по карте');
    op.value = Math.round(s.opacity * 100);
    if (typeof s.toolbarCollapsed === 'boolean') applyCollapsed(s.toolbarCollapsed);
  });
  // Событие на случай, если состояние пришло без перезагрузки страницы
  document.addEventListener('eft-overlay-state', (e) => {
    if (e.detail && typeof e.detail.toolbarCollapsed === 'boolean') applyCollapsed(e.detail.toolbarCollapsed);
  });

  applyCollapsed(state.collapsed);
})();