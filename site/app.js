(function () {
  'use strict';

  /* ---------- Мини-рендерер markdown (без внешних зависимостей) ---------- */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(text) {
    let s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return s;
  }

  function isTableRow(line) {
    return /^\|.*\|$/.test(line);
  }
  function isTableSep(line) {
    return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line);
  }
  function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  function mdToHtml(md) {
    if (!md) return '';
    const lines = md.split('\n');
    let html = '';
    let listBuffer = [];
    let listType = null; // 'ul' | 'ol'
    let paraBuffer = [];

    function flushPara() {
      if (paraBuffer.length) {
        html += `<p>${inline(paraBuffer.join(' '))}</p>`;
        paraBuffer = [];
      }
    }
    function flushList() {
      if (listBuffer.length) {
        const tag = listType === 'ol' ? 'ol' : 'ul';
        html += `<${tag}>${listBuffer.map((li) => `<li>${inline(li)}</li>`).join('')}</${tag}>`;
        listBuffer = [];
      }
      listType = null;
    }

    let i = 0;
    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (trimmed === '') {
        flushPara();
        flushList();
        i += 1;
        continue;
      }

      if (isTableRow(trimmed) && i + 1 < lines.length && isTableSep(lines[i + 1].trim())) {
        flushPara();
        flushList();
        const header = splitTableRow(trimmed);
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i].trim())) {
          rows.push(splitTableRow(lines[i].trim()));
          i += 1;
        }
        html +=
          '<div class="table-wrap"><table><thead><tr>' +
          header.map((h) => `<th>${inline(h)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table></div>';
        continue;
      }

      let m = trimmed.match(/^(#{3,6})\s+(.*)$/);
      if (m) {
        flushPara();
        flushList();
        const level = Math.min(6, m[1].length - 3 + 4);
        html += `<h${level}>${inline(m[2])}</h${level}>`;
        i += 1;
        continue;
      }

      if (trimmed === '---' || trimmed === '***') {
        flushPara();
        flushList();
        html += '<hr/>';
        i += 1;
        continue;
      }

      m = trimmed.match(/^[-*]\s+(.*)$/);
      if (m) {
        flushPara();
        if (listType === 'ol') flushList();
        listType = 'ul';
        listBuffer.push(m[1]);
        i += 1;
        continue;
      }

      m = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (m) {
        flushPara();
        if (listType === 'ul') flushList();
        listType = 'ol';
        listBuffer.push(m[1]);
        i += 1;
        continue;
      }

      m = trimmed.match(/^>\s?(.*)$/);
      if (m) {
        flushPara();
        flushList();
        html += `<blockquote>${inline(m[1])}</blockquote>`;
        i += 1;
        continue;
      }

      flushList();
      paraBuffer.push(trimmed);
      i += 1;
    }
    flushPara();
    flushList();
    return html;
  }

  /* ---------- Переключатель светлой/тёмной темы ---------- */

  function setupThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const icon = btn.querySelector('.theme-icon');

    function apply(theme) {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        icon.textContent = '☀️';
        btn.title = 'Переключить на светлую тему';
      } else {
        document.documentElement.removeAttribute('data-theme');
        icon.textContent = '🌙';
        btn.title = 'Переключить на тёмную тему';
      }
    }

    apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      apply(next);
    });
  }

  setupThemeToggle();

  /* ---------- Состояние и загрузка данных ---------- */

  let DATA = null;
  const els = {
    ticketsContainer: document.getElementById('tickets-container'),
    ticketNav: document.getElementById('ticket-nav'),
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    searchMeta: document.getElementById('search-meta'),
  };

  fetch('data.json')
    .then((r) => r.json())
    .then((data) => {
      DATA = data;
      renderAll();
      setupSearch();
      setupActiveNavTracking();
    })
    .catch((err) => {
      els.ticketsContainer.innerHTML = `<p class="no-results">Не удалось загрузить данные: ${escapeHtml(String(err))}</p>`;
    });

  function toggleBlockHtml(ticketId, key, label, md) {
    if (!md) return '';
    const panelId = `${key}-${ticketId}`;
    return `<button class="detail-toggle" aria-expanded="false" data-target="${panelId}">
               <span class="chevron">▸</span> ${label}
             </button>
             <div class="detail-panel" id="${panelId}">
               <div class="detail-inner ticket-body">${mdToHtml(md)}</div>
             </div>`;
  }

  function ticketCardHtml(ticket) {
    // Обычный билет: краткий ответ виден сразу, подробный — под дропдауном.
    // Билет без краткого ответа (напр. вводный раздел 0): подробный ответ становится основным текстом.
    const hasShort = Boolean(ticket.contentMd);
    const mainMd = hasShort ? ticket.contentMd : ticket.detailedMd;

    const toggles = hasShort ? toggleBlockHtml(ticket.id, 'detail', 'Подробный ответ', ticket.detailedMd) : '';

    return `
      <article class="ticket-card" id="ticket-${ticket.id}" data-ticket-id="${ticket.id}">
        <div class="ticket-card-header">
          <span class="ticket-id">${ticket.id}</span>
          <h3 class="ticket-title">${inline(ticket.title)}</h3>
        </div>
        <div class="ticket-body">${mdToHtml(mainMd)}</div>
        ${toggles ? `<div class="toggle-row">${toggles}</div>` : ''}
      </article>`;
  }

  function renderAll() {
    let contentHtml = '';
    for (const section of DATA.sections) {
      contentHtml += `
        <div class="section-block" id="section-${section.id}">
          <h2 class="section-heading">${inline(section.title)}</h2>
          ${section.introMd ? `<div class="section-intro ticket-body">${mdToHtml(section.introMd)}</div>` : ''}
          <div class="tickets-grid">
            ${section.tickets.map(ticketCardHtml).join('')}
          </div>
        </div>`;
    }

    if (DATA.extras && DATA.extras.length) {
      contentHtml += `
        <div class="section-block" id="section-appendix">
          <h2 class="section-heading">Приложение</h2>
          <div class="tickets-grid">
            ${DATA.extras
              .map(
                (extra) => `
                  <article class="ticket-card">
                    <h3 class="ticket-title">${inline(extra.title)}</h3>
                    <div class="ticket-body">${mdToHtml(extra.contentMd)}</div>
                  </article>`
              )
              .join('')}
          </div>
        </div>`;
    }

    els.ticketsContainer.innerHTML = contentHtml;

    let navHtml = '';
    for (const section of DATA.sections) {
      navHtml += `<div class="nav-group" data-nav-section="${section.id}">
        <p class="nav-section-title">${escapeHtml(section.title)}</p>
        <ul class="nav-list">
          ${section.tickets
            .map(
              (t) =>
                `<li class="nav-item" data-nav-ticket="${t.id}">
                   <a href="#ticket-${t.id}"><span class="nav-id">${t.id}</span>${escapeHtml(t.title)}</a>
                 </li>`
            )
            .join('')}
        </ul>
      </div>`;
    }
    els.ticketNav.innerHTML = navHtml;

    els.ticketsContainer.addEventListener('click', onToggleClick);
  }

  function onToggleClick(e) {
    const btn = e.target.closest('.detail-toggle');
    if (!btn) return;
    const panel = document.getElementById(btn.dataset.target);
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    panel.classList.toggle('open', !expanded);
  }

  /* ---------- Поиск ---------- */

  function normalize(s) {
    return s.toLowerCase().replace(/ё/g, 'е');
  }

  function setupSearch() {
    let query = '';

    function apply() {
      const q = normalize(query.trim());
      const words = q.split(/\s+/).filter(Boolean);

      let totalMatched = 0;
      let totalTickets = 0;

      for (const section of DATA.sections) {
        let sectionMatched = 0;
        for (const ticket of section.tickets) {
          totalTickets += 1;
          const haystack = normalize(ticket.searchText);
          const titleMatch = words.length === 0 || words.every((w) => normalize(ticket.title).includes(w));
          const anyMatch = words.length === 0 || words.every((w) => haystack.includes(w));
          const visible = anyMatch;

          const card = document.getElementById(`ticket-${ticket.id}`);
          const navItem = document.querySelector(`.nav-item[data-nav-ticket="${CSS.escape(ticket.id)}"]`);
          if (card) card.style.display = visible ? '' : 'none';
          if (navItem) navItem.style.display = visible ? '' : 'none';

          if (visible) {
            sectionMatched += 1;
            totalMatched += 1;
          }
        }

        const sectionBlock = document.getElementById(`section-${section.id}`);
        const navGroup = document.querySelector(`.nav-group[data-nav-section="${CSS.escape(section.id)}"]`);
        const sectionVisible = sectionMatched > 0;
        if (sectionBlock) sectionBlock.style.display = sectionVisible ? '' : 'none';
        if (navGroup) navGroup.style.display = sectionVisible ? '' : 'none';
      }

      // Приложение скрываем при активном поиске (не участвует в полнотекстовом поиске по билетам)
      const appendixBlock = document.getElementById('section-appendix');
      if (appendixBlock) appendixBlock.style.display = words.length === 0 ? '' : 'none';

      els.searchClear.hidden = query.length === 0;

      if (words.length === 0) {
        els.searchMeta.textContent = `Всего билетов: ${totalTickets}`;
      } else if (totalMatched === 0) {
        els.searchMeta.textContent = 'Ничего не найдено';
      } else {
        els.searchMeta.textContent = `Найдено: ${totalMatched} из ${totalTickets}`;
      }
    }

    els.searchInput.addEventListener('input', (e) => {
      query = e.target.value;
      apply();
    });

    els.searchClear.addEventListener('click', () => {
      query = '';
      els.searchInput.value = '';
      els.searchInput.focus();
      apply();
    });

    apply();
  }

  /* ---------- Подсветка текущего билета в навигации при скролле ---------- */

  function setupActiveNavTracking() {
    const cards = Array.from(document.querySelectorAll('.ticket-card[data-ticket-id]'));
    if (!('IntersectionObserver' in window) || cards.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.dataset.ticketId;
          document.querySelectorAll('.nav-item a.active').forEach((a) => a.classList.remove('active'));
          const link = document.querySelector(`.nav-item[data-nav-ticket="${CSS.escape(id)}"] a`);
          if (link) link.classList.add('active');
        }
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );

    cards.forEach((c) => observer.observe(c));
  }
})();
