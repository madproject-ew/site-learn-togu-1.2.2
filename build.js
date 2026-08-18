#!/usr/bin/env node
// Парсит markdown-файлы из "данные/" в site/data.json.
// Без внешних зависимостей — запускается локально и в GitHub Actions.
//
// Три источника на один и тот же билет "X.Y":
//   short    — Шпаргалка (краткий основной ответ)
//   explain  — Объяснение на пальцах (простыми словами)
//   detailed — Подробная подготовка (полная теория)
// Разделы/билеты объединяются по id: структура (порядок разделов и билетов)
// берётся из самого полного источника, а не привязана к одному файлу —
// так сайт переживает добавление нового раздела в один из файлов.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'данные');
const OUT_FILE = path.join(__dirname, 'site', 'data.json');

const SHORT_FILE = path.join(DATA_DIR, 'Шпаргалка_на_билет_1.2.2.md');
const DETAILED_FILE = path.join(DATA_DIR, 'Подробная_подготовка_1.2.2.md');
const EXPLAIN_FILE = path.join(DATA_DIR, 'Объяснение_на_пальцах_1.2.2.md');

// Заголовок раздела: "# Раздел N. ..." или вводный раздел 0, который в разных
// файлах называют по-разному ("Нулевой раздел. ...", "Нулевой минимум ...").
function matchSectionHeader(line) {
  let m = line.match(/^#\s+Раздел\s+(\d+)\.\s*(.*)$/);
  if (m) return { id: m[1], title: `Раздел ${m[1]}. ${m[2]}`.trim() };

  m = line.match(/^#\s+Нулевой\s+раздел\.?\s*(.*)$/i);
  if (m) return { id: '0', title: `Раздел 0. ${m[1]}`.trim() };

  m = line.match(/^#\s+Нулевой\s+(.*)$/i);
  if (m) {
    const rest = m[1].trim();
    return { id: '0', title: `Раздел 0. ${rest.charAt(0).toUpperCase()}${rest.slice(1)}` };
  }

  return null;
}

// Разбирает один markdown-файл на разделы с билетами ("## X.Y. Título")
// и "хвостовые" верхнеуровневые блоки (приложения, памятки — не билеты).
function parseFile(text) {
  const lines = text.split('\n');
  const sections = [];
  const extras = [];
  let curSection = null;
  let curTicket = null;
  let curExtra = null;
  let mode = 'preamble'; // preamble | section | extra

  const flush = () => {
    if (curTicket && curSection) {
      curTicket.contentMd = curTicket.lines.join('\n').trim();
      delete curTicket.lines;
      curSection.tickets.push(curTicket);
    }
    if (curSection && curSection.introLines) {
      curSection.introMd = curSection.introLines
        .join('\n')
        .trim()
        .replace(/\n{0,2}-{3,}\s*$/, '') // хвостовой "---"-разделитель перед первым билетом — не контент
        .trim();
      delete curSection.introLines;
    }
    if (curExtra) {
      curExtra.contentMd = curExtra.lines.join('\n').trim();
      delete curExtra.lines;
      if (curExtra.contentMd) extras.push(curExtra);
    }
    curTicket = null;
    curExtra = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    const sec = matchSectionHeader(line);
    if (sec) {
      flush();
      curSection = { id: sec.id, title: sec.title, tickets: [], introLines: [] };
      sections.push(curSection);
      mode = 'section';
      continue;
    }

    let m = line.match(/^##\s+(\d+\.\d+)\.\s*(.*)$/);
    if (m && mode === 'section') {
      if (curTicket) {
        curTicket.contentMd = curTicket.lines.join('\n').trim();
        delete curTicket.lines;
        curSection.tickets.push(curTicket);
      }
      curTicket = { id: m[1], title: m[2].trim(), lines: [] };
      continue;
    }

    m = line.match(/^#\s+(.*)$/);
    if (m && mode !== 'preamble') {
      flush();
      mode = 'extra';
      curExtra = { title: m[1].trim(), lines: [] };
      continue;
    }

    if (curTicket) {
      curTicket.lines.push(line);
    } else if (curExtra) {
      curExtra.lines.push(line);
    } else if (curSection) {
      // Текст сразу под заголовком раздела, до первого билета "## X.Y." —
      // вводный конспект раздела целиком (напр. "Нулевой минимум обозначений").
      curSection.introLines.push(line);
    }
    // mode === 'preamble' и ни то ни другое — вступительный текст перед первым разделом, не используется
  }
  flush();

  return { sections, extras };
}

function toMaps(parsed) {
  const sectionTitleById = {};
  const sectionIntroById = {};
  const ticketTitleById = {};
  const ticketContentById = {};
  for (const section of parsed.sections) {
    sectionTitleById[section.id] = section.title;
    if (section.introMd) sectionIntroById[section.id] = section.introMd;
    for (const ticket of section.tickets) {
      ticketTitleById[ticket.id] = ticket.title;
      ticketContentById[ticket.id] = ticket.contentMd;
    }
  }
  return { sectionTitleById, sectionIntroById, ticketTitleById, ticketContentById };
}

// Порядок разделов/билетов берём объединением по всем источникам:
// какой файл первым ввёл раздел/билет, того порядка и держимся,
// остальные источники лишь дополняют структуру недостающими id.
function buildSkeleton(parsedFiles) {
  const sectionOrder = [];
  const sectionsById = new Map();

  for (const parsed of parsedFiles) {
    for (const section of parsed.sections) {
      if (!sectionsById.has(section.id)) {
        sectionsById.set(section.id, { id: section.id, ticketOrder: [], ticketIds: new Set() });
        sectionOrder.push(section.id);
      }
      const sec = sectionsById.get(section.id);
      for (const ticket of section.tickets) {
        if (!sec.ticketIds.has(ticket.id)) {
          sec.ticketIds.add(ticket.id);
          sec.ticketOrder.push(ticket.id);
        }
      }
    }
  }

  sectionOrder.sort((a, b) => Number(a) - Number(b));
  return sectionOrder.map((id) => ({ id, ticketIds: sectionsById.get(id).ticketOrder }));
}

function stripMd(md) {
  return md
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function main() {
  const shortText = fs.readFileSync(SHORT_FILE, 'utf8');
  const detailedText = fs.readFileSync(DETAILED_FILE, 'utf8');
  const explainText = fs.readFileSync(EXPLAIN_FILE, 'utf8');

  const shortParsed = parseFile(shortText);
  const detailedParsed = parseFile(detailedText);
  const explainParsed = parseFile(explainText);

  const shortMaps = toMaps(shortParsed);
  const detailedMaps = toMaps(detailedParsed);
  const explainMaps = toMaps(explainParsed);

  // Структуру (порядок) берём из самого полного источника (Подробная — она
  // первой получает новые разделы), явные и "на пальцах" лишь дополняют.
  const skeleton = buildSkeleton([detailedParsed, explainParsed, shortParsed]);

  let totalTickets = 0;
  const sections = skeleton.map(({ id, ticketIds }) => {
    const title =
      shortMaps.sectionTitleById[id] || explainMaps.sectionTitleById[id] || detailedMaps.sectionTitleById[id] || `Раздел ${id}`;
    const introMd =
      shortMaps.sectionIntroById[id] || explainMaps.sectionIntroById[id] || detailedMaps.sectionIntroById[id] || '';

    const tickets = ticketIds.map((ticketId) => {
      const title =
        shortMaps.ticketTitleById[ticketId] || explainMaps.ticketTitleById[ticketId] || detailedMaps.ticketTitleById[ticketId] || ticketId;
      const contentMd = shortMaps.ticketContentById[ticketId] || '';
      const explainMd = explainMaps.ticketContentById[ticketId] || '';
      const detailedMd = detailedMaps.ticketContentById[ticketId] || '';
      totalTickets += 1;
      return {
        id: ticketId,
        title,
        contentMd,
        explainMd,
        detailedMd,
        searchText: (
          ticketId +
          ' ' +
          title +
          ' ' +
          stripMd(contentMd) +
          ' ' +
          stripMd(explainMd) +
          ' ' +
          stripMd(detailedMd)
        ).toLowerCase(),
      };
    });

    return { id, title, introMd, tickets };
  });

  const extras = [...shortParsed.extras, ...detailedParsed.extras, ...explainParsed.extras].map((e) => ({
    title: e.title,
    contentMd: e.contentMd,
  }));

  const data = {
    generatedFrom: {
      short: path.basename(SHORT_FILE),
      detailed: path.basename(DETAILED_FILE),
      explain: path.basename(EXPLAIN_FILE),
    },
    sections,
    extras,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`OK: ${totalTickets} билетов в ${sections.length} разделах, ${extras.length} блоков приложения -> ${path.relative(__dirname, OUT_FILE)}`);
}

main();
