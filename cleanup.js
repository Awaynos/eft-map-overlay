// Инжектируется в страницу eft.su: скрывает "лишний" интерфейс сайта поверх карты,
// скругляет рамку, возвращает переключатель "Спутник/Схема" в правый угол
// и сообщает главному процессу зоны, в которых клики должны доходить до оверлея.
(() => {
  const addStyle = (css) => {
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  };
  addStyle(`
    /* сайдбар с меню сайта */
    div.h-screen.fixed.left-0.top-0 { display: none !important; }
    /* убираем резерв под сайдбар: контейнер контента смещался вправо на 256px */
    div.min-w-0.flex-1 { margin-left: 0 !important; }
    /* баннер "а мы делаем аналог дискорда" */
    div.absolute.bottom-8.left-1\\/2.-translate-x-1\\/2 { display: none !important; }
    /* карточка "Таможня / Рейд: 35м" */
    div.absolute.bottom-4.left-4.z-20 { display: none !important; }
    /* кнопка AI помощника (fixed внизу справа) */
    div.fixed[class*="bottom-[calc(4rem"] { display: none !important; }
    /* переключатель "Спутник/Схема" — закрепляем в левом нижнем углу,
       чтобы сайт его не уводил и он не конфликтовал с легендой */
    div.absolute.right-4.top-4.z-20 {
      position: fixed !important;
      left: 16px !important;
      bottom: 16px !important;
      top: auto !important;
      right: auto !important;
      z-index: 30 !important;
    }
    /* панель "переходы/фильтры" — поднимаем в правый верхний угол (место переключателя) */
    div.absolute.right-4.z-20[class*="top-[6.5rem]"] { top: 16px !important; right: 16px !important; }
    /* скруглённая рамка оверлея: фон прозрачный, контейнер скруглён */
    html, body { background: transparent !important; }
    div.flex.min-h-screen.bg-background { border-radius: 14px !important; overflow: hidden !important; }
  `);

  // Кнопка-гамбургер открытия меню (слева сверху, без текста) — убрать
  const killMenuBtn = () => {
    document.querySelectorAll('button').forEach((b) => {
      const r = b.getBoundingClientRect();
      if (r.left < 60 && r.top < 60 && r.width < 60 && !(b.textContent || '').trim()) b.style.display = 'none';
    });
  };
  killMenuBtn();
  setTimeout(killMenuBtn, 800);

  // Просим страницу пересчитать размеры (OpenLayers подгонит карту под новое место)
  const kickResize = () => {
    window.dispatchEvent(new Event('resize'));
    document.querySelectorAll('.ol-viewport').forEach((v) => v.dispatchEvent(new Event('resize')));
  };
  kickResize();
  setTimeout(kickResize, 900);

  // Зоны, где клики должны доходить до оверлея (переключатель и боковая панель сайта)
  const setZones = (zones) => {
    try { if (window.eftOverlay && window.eftOverlay.setInteractiveZones) window.eftOverlay.setInteractiveZones(zones); } catch (_) {}
  };
  const collectZones = () => {
    const zones = [];
    const pick = (el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) zones.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    };
    pick(document.querySelector('div.absolute.right-4.top-4.z-20'));         // переключатель спутник/схема
    // боковая панель: берём отдельные карточки, а не весь растянутый контейнер
    const panel = document.querySelector('div[class*="top-[6.5rem]"]');
    if (panel && panel.children.length) {
      [...panel.children].forEach((c) => pick(c));
    } else {
      pick(panel);
    }
    setZones(zones);
  };
  collectZones();
  setInterval(collectZones, 1000);

  // Перехват кнопки "Во весь экран": вместо сайта разворачиваем окно оверлея
  const bindFullscreen = () => {
    document.querySelectorAll('button').forEach((b) => {
      if (b.__eftFsBound) return;
      const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase();
      if (label.includes('весь экран') || label.includes('full')) {
        b.__eftFsBound = true;
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          try { if (window.eftOverlay && window.eftOverlay.toggleMaximize) window.eftOverlay.toggleMaximize(); } catch (_) {}
        }, true);
      }
    });
  };
  bindFullscreen();
  setInterval(bindFullscreen, 1500);
})();