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

  function mdToHtml(md) {
    if (!md) return '';
    const lines = md.split('\n');
    let html = '';
    let listBuffer = [];
    let paraBuffer = [];

    function flushPara() {
      if (paraBuffer.length) {
        html += `<p>${inline(paraBuffer.join(' '))}</p>`;
        paraBuffer = [];
      }
    }
    function flushList() {
      if (listBuffer.length) {
        html += `<ul>${listBuffer.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`;
        listBuffer = [];
      }
    }

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      if (trimmed === '') {
        flushPara();
        flushList();
        continue;
      }

      let m = trimmed.match(/^(#{3,6})\s+(.*)$/);
      if (m) {
        flushPara();
        flushList();
        const level = Math.min(6, m[1].length - 3 + 4);
        html += `<h${level}>${inline(m[2])}</h${level}>`;
        continue;
      }

      if (trimmed === '---' || trimmed === '***') {
        flushPara();
        flushList();
        html += '<hr/>';
        continue;
      }

      m = trimmed.match(/^[-*]\s+(.*)$/);
      if (m) {
        flushPara();
        listBuffer.push(m[1]);
        continue;
      }

      m = trimmed.match(/^>\s?(.*)$/);
      if (m) {
        flushPara();
        flushList();
        html += `<blockquote>${inline(m[1])}</blockquote>`;
        continue;
      }

      flushList();
      paraBuffer.push(trimmed);
    }
    flushPara();
    flushList();
    return html;
  }

  /* ---------- Состояние и загрузка данных ---------- */

  let DATA = null;
  const els = {
    introPanel: document.getElementById('intro-panel'),
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
      renderIntro();
      renderAll();
      setupSearch();
      setupActiveNavTracking();
    })
    .catch((err) => {
      els.ticketsContainer.innerHTML = `<p class="no-results">Не удалось загрузить данные: ${escapeHtml(String(err))}</p>`;
    });

  function renderIntro() {
    let html = '';
    if (DATA.intro) html += mdToHtml(DATA.intro);
    if (DATA.guide) {
      html += `<details><summary style="cursor:pointer;color:var(--text);font-weight:600;">Как пользоваться материалами</summary>${mdToHtml(DATA.guide)}</details>`;
    }
    els.introPanel.innerHTML = html;
  }

  function ticketCardHtml(ticket) {
    return `
      <article class="ticket-card" id="ticket-${ticket.id}" data-ticket-id="${ticket.id}">
        <div class="ticket-card-header">
          <span class="ticket-id">${ticket.id}</span>
          <h3 class="ticket-title">${inline(ticket.title)}</h3>
        </div>
        <div class="ticket-body">${mdToHtml(ticket.contentMd)}</div>
        ${
          ticket.detailedMd
            ? `<button class="detail-toggle" aria-expanded="false" data-target="detail-${ticket.id}">
                 <span class="chevron">▸</span> Подробный ответ
               </button>
               <div class="detail-panel" id="detail-${ticket.id}">
                 <div class="detail-inner ticket-body">${mdToHtml(ticket.detailedMd)}</div>
               </div>`
            : ''
        }
      </article>`;
  }

  function renderAll() {
    let contentHtml = '';
    for (const section of DATA.sections) {
      contentHtml += `
        <div class="section-block" id="section-${section.id}">
          <h2 class="section-heading">${inline(section.title)}</h2>
          <div class="tickets-grid">
            ${section.tickets.map(ticketCardHtml).join('')}
          </div>
        </div>`;
    }

    if (DATA.appendix) {
      contentHtml += `
        <div class="section-block" id="section-appendix">
          <h2 class="section-heading">${inline(DATA.appendix.title)}</h2>
          <div class="tickets-grid">
            <article class="ticket-card">
              <div class="ticket-body">${mdToHtml(DATA.appendix.contentMd)}</div>
            </article>
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
