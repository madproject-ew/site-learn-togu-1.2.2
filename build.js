#!/usr/bin/env node
// Парсит markdown-файлы из "данные/" в site/data.json.
// Без внешних зависимостей — запускается локально и в GitHub Actions.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'данные');
const OUT_FILE = path.join(__dirname, 'site', 'data.json');

const SHORT_FILE = path.join(DATA_DIR, 'Шпаргалка_на_билет_1.2.2.md');
const DETAILED_FILE = path.join(DATA_DIR, 'Подробная_подготовка_1.2.2.md');
const EXPLAIN_FILE = path.join(DATA_DIR, 'Объяснение_на_пальцах_1.2.2.md');

function parseShort(text) {
  const lines = text.split('\n');
  const sections = [];
  let intro = [];
  let appendix = null;
  let curSection = null;
  let curTicket = null;
  let mode = 'preamble'; // preamble | section | appendix

  const flushTicket = () => {
    if (curTicket && curSection) {
      curTicket.contentMd = curTicket.lines.join('\n').trim();
      delete curTicket.lines;
      curSection.tickets.push(curTicket);
    }
    curTicket = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    let m = line.match(/^#\s+Раздел\s+(\d+)\.\s*(.*)$/);
    if (m) {
      flushTicket();
      curSection = { id: m[1], title: `Раздел ${m[1]}. ${m[2]}`.trim(), tickets: [] };
      sections.push(curSection);
      mode = 'section';
      continue;
    }

    m = line.match(/^#\s+Приложение\.?\s*(.*)$/);
    if (m) {
      flushTicket();
      appendix = { title: line.replace(/^#\s+/, '').trim(), lines: [] };
      mode = 'appendix';
      continue;
    }

    m = line.match(/^##\s+(\d+\.\d+)\.\s*(.*)$/);
    if (m && mode === 'section') {
      flushTicket();
      curTicket = { id: m[1], title: m[2].trim(), lines: [] };
      continue;
    }

    if (mode === 'appendix' && appendix) {
      appendix.lines.push(line);
    } else if (curTicket) {
      curTicket.lines.push(line);
    } else if (mode === 'preamble') {
      intro.push(line);
    }
  }
  flushTicket();

  if (appendix) {
    appendix.contentMd = appendix.lines.join('\n').trim();
    delete appendix.lines;
  }

  // Убираем заголовок "# Шпаргалка ..." из intro, оставляем описательный текст
  intro = intro.filter((l) => !/^#\s+Шпаргалка/.test(l));

  return { intro: intro.join('\n').trim(), sections, appendix };
}

function parseDetailed(text) {
  const lines = text.split('\n');
  const byId = {};
  let guideLines = [];
  let curTicketId = null;
  let curLines = [];
  let mode = 'preamble'; // preamble | section

  const flush = () => {
    if (curTicketId) {
      byId[curTicketId] = curLines.join('\n').trim();
    }
    curTicketId = null;
    curLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    if (/^#\s+Раздел\s+\d+\./.test(line)) {
      flush();
      mode = 'section';
      continue;
    }

    const m = line.match(/^##\s+(\d+\.\d+)\.\s*(.*)$/);
    if (m && mode === 'section') {
      flush();
      curTicketId = m[1];
      continue;
    }

    if (curTicketId) {
      curLines.push(line);
    } else if (mode === 'preamble') {
      guideLines.push(line);
    }
  }
  flush();

  const guide = guideLines
    .join('\n')
    .replace(/^#\s+Подробная подготовка.*$/m, '')
    .trim();

  return { byId, guide };
}

// Парсит "Объяснение на пальцах": билеты по id + хвостовые общие разделы
// (не привязанные к конкретному билету), которые уходят в приложение.
function parseExplain(text) {
  const lines = text.split('\n');
  const byId = {};
  const extras = [];
  let curTicketId = null;
  let curLines = [];
  let curExtra = null;
  let mode = 'preamble'; // preamble | section | extra

  const flush = () => {
    if (curTicketId) {
      byId[curTicketId] = curLines.join('\n').trim();
    }
    if (curExtra) {
      curExtra.contentMd = curExtra.lines.join('\n').trim();
      delete curExtra.lines;
      if (curExtra.contentMd) extras.push(curExtra);
    }
    curTicketId = null;
    curLines = [];
    curExtra = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    if (/^#\s+Раздел\s+\d+\./.test(line)) {
      flush();
      mode = 'section';
      continue;
    }

    let m = line.match(/^##\s+(\d+\.\d+)\.\s*(.*)$/);
    if (m && mode === 'section') {
      flush();
      curTicketId = m[1];
      continue;
    }

    m = line.match(/^#\s+(.*)$/);
    if (m && mode !== 'preamble') {
      flush();
      mode = 'extra';
      curExtra = { title: m[1].trim(), lines: [] };
      continue;
    }

    if (curTicketId) {
      curLines.push(line);
    } else if (curExtra) {
      curExtra.lines.push(line);
    }
  }
  flush();

  return { byId, extras };
}

function stripMd(md) {
  return md
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function main() {
  const shortText = fs.readFileSync(SHORT_FILE, 'utf8');
  const detailedText = fs.readFileSync(DETAILED_FILE, 'utf8');
  const explainText = fs.readFileSync(EXPLAIN_FILE, 'utf8');

  const short = parseShort(shortText);
  const detailed = parseDetailed(detailedText);
  const explain = parseExplain(explainText);

  let totalTickets = 0;
  for (const section of short.sections) {
    for (const ticket of section.tickets) {
      ticket.explainMd = explain.byId[ticket.id] || '';
      ticket.detailedMd = detailed.byId[ticket.id] || '';
      ticket.searchText = (
        ticket.id +
        ' ' +
        ticket.title +
        ' ' +
        stripMd(ticket.contentMd) +
        ' ' +
        stripMd(ticket.explainMd) +
        ' ' +
        stripMd(ticket.detailedMd)
      ).toLowerCase();
      totalTickets += 1;
    }
  }

  if (short.appendix && explain.extras.length) {
    const extraMd = explain.extras.map((e) => `### ${e.title}\n\n${e.contentMd}`).join('\n\n');
    short.appendix.contentMd = `${short.appendix.contentMd}\n\n${extraMd}`.trim();
  }

  const data = {
    generatedFrom: {
      short: path.basename(SHORT_FILE),
      detailed: path.basename(DETAILED_FILE),
      explain: path.basename(EXPLAIN_FILE),
    },
    intro: short.intro,
    guide: detailed.guide,
    sections: short.sections,
    appendix: short.appendix,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`OK: ${totalTickets} билетов в ${short.sections.length} разделах -> ${path.relative(__dirname, OUT_FILE)}`);
}

main();
