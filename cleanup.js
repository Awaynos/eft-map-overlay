// Инжектируется в страницу eft.su: скрывает "лишний" интерфейс сайта поверх карты.
(() => {
  const addStyle = (css) => {
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  };
  addStyle(`
    /* сайдбар с меню сайта */
    div.h-screen.fixed.left-0.top-0 { display: none !important; }
    /* баннер "а мы делаем аналог дискорда" */
    div.absolute.bottom-8.left-1\\/2.-translate-x-1\\/2 { display: none !important; }
    /* карточка "Таможня / Рейд: 35м" */
    div.absolute.bottom-4.left-4.z-20 { display: none !important; }
    /* кнопка AI помощника (fixed внизу справа) */
    div.fixed[class*="bottom-[calc(4rem"] { display: none !important; }
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
})();