#!/usr/bin/env node
// Собирает site/data.json (уже распарсенные и починенные Ответы + Подробное
// объяснение) в один markdown-файл и конвертирует его в .docx через pandoc,
// чтобы билеты можно было открыть офлайн на телефоне (Word/Google Docs/Pages).
// Требует установленный pandoc: `brew install pandoc`.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA_FILE = path.join(__dirname, 'site', 'data.json');
const OUT_MD = path.join(__dirname, 'site', 'bilety-1.2.2.md');
const OUT_DOCX = path.join(__dirname, 'site', 'bilety-1.2.2.docx');

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const parts = ['# Билеты 1.2.2 — краткие и подробные ответы', ''];

  for (const section of data.sections) {
    parts.push(`## ${section.title}`, '');
    if (section.introMd) parts.push(section.introMd, '');

    for (const ticket of section.tickets) {
      parts.push(`### ${ticket.id}. ${ticket.title}`, '');
      if (ticket.contentMd) {
        parts.push(ticket.contentMd, '');
        if (ticket.detailedMd) {
          parts.push('**Подробный ответ**', '', ticket.detailedMd, '');
        }
      } else if (ticket.detailedMd) {
        parts.push(ticket.detailedMd, '');
      }
    }
  }

  if (data.extras && data.extras.length) {
    parts.push('## Приложение', '');
    for (const extra of data.extras) {
      parts.push(`### ${extra.title}`, '', extra.contentMd, '');
    }
  }

  const md = parts.join('\n');
  fs.writeFileSync(OUT_MD, md, 'utf8');

  execFileSync(
    'pandoc',
    [
      OUT_MD,
      '-f', 'markdown+tex_math_dollars',
      '-o', OUT_DOCX,
      '--toc',
      '--toc-depth=3',
      '--metadata', 'title=Билеты 1.2.2',
    ],
    { stdio: 'inherit' }
  );

  fs.unlinkSync(OUT_MD);
  const { size } = fs.statSync(OUT_DOCX);
  console.log(`OK: ${path.relative(__dirname, OUT_DOCX)} (${(size / 1024 / 1024).toFixed(2)} МБ)`);
}

main();
