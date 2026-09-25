#!/usr/bin/env node
// mega-hwp — HWP/HWPX 읽기·생성·양식 채우기·렌더링. 엔진: @rhwp/core (Rust+WASM, MIT)
//
//   node hwp.mjs text   in.hwp                         본문+표를 마크다운으로 (표·셀 주소 포함)
//   node hwp.mjs build  doc.json -o out.hwp            doc.json → .hwp / .hwpx (확장자로 결정)
//   node hwp.mjs fill   form.hwp fill.json -o out.hwp  양식 채우기
//   node hwp.mjs render in.hwp [-o dir] [--pages 1-3]  페이지 PNG (rsvg-convert)
//   node hwp.mjs hancom in.hwp [-o dir]                macOS: 한컴오피스로 열어 화면 캡처 (hancom.swift)
//
// 스펙: references/schema.md
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WARN = [];
let unzipSync, zipSync, strToU8, strFromU8; // fflate — loadCore()에서 설치 후 불러온다
const warn = (m) => WARN.push(m);

// ── engine ────────────────────────────────────────────────────────────────
export async function loadCore() {
  const dir = path.join(SKILL, 'node_modules/@rhwp/core');
  if (!fs.existsSync(dir) || !fs.existsSync(path.join(SKILL, 'node_modules/fflate'))) {
    console.error('[mega-hwp] 최초 1회 @rhwp/core 설치 중…');
    execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund'], { cwd: SKILL, stdio: 'inherit' });
  }
  // ponytail: 글자 폭 근사치(CJK 1em, 라틴 0.55em). 렌더 PNG의 줄바꿈에만 영향 — 한글(한컴)은 열 때 다시 조판한다.
  globalThis.measureTextWidth = (font, text) => {
    const px = +(/([\d.]+)px/.exec(font)?.[1] ?? 13);
    let w = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      w += (c >= 0x1100 && c <= 0x11ff) || c >= 0x2e80 ? px : c === 32 ? px * 0.3 : px * 0.55;
    }
    return w;
  };
  ({ unzipSync, zipSync, strToU8, strFromU8 } = await import(path.join(SKILL, 'node_modules/fflate/esm/index.mjs')));
  const core = await import(path.join(dir, 'rhwp.js'));
  await core.default({ module_or_path: fs.readFileSync(path.join(dir, 'rhwp_bg.wasm')) });
  return core;
}

const J = (s) => {
  const r = typeof s === 'string' && /^[[{]/.test(s) ? JSON.parse(s) : s;
  if (r && r.ok === false) throw new Error(s);
  return r;
};
const len = (s) => [...s].length;
const PT = 200; // rhwp 문단 여백 단위: 1pt = 200

// ── theme ─────────────────────────────────────────────────────────────────
// 실제 사업계획서·결과보고서 12종에서 가장 흔한 조합 (references/style-guide.md)
export const THEME = {
  body: '휴먼명조', // ○ - · 본문
  head: 'HY헤드라인M', // 제목, □
  table: '맑은 고딕', // 표·상자
  note: '맑은 고딕', // ※
  size: 13, // 본문 pt
  lineSpacing: 160, // %
  accent: '#1F3864', // 장 번호 칸, 선
  headerFill: '#DCE3EE', // 표 머리행·머리열
  soft: '#F2F4F8', // 요약 상자
  guide: '#1F4FC1', // 작성요령 글자
};

// 기호 → [수준, 글자 크기 차이(pt), 굵게, 서체 키]
const MARKERS = {
  '□': [0, 2, true, 'head'], '■': [0, 2, true, 'head'],
  '○': [1, 0, false, 'body'], 'ㅇ': [1, 0, false, 'body'], '◦': [1, 0, false, 'body'],
  '-': [2, 0, false, 'body'], '·': [3, -1, false, 'body'], '•': [3, -1, false, 'body'],
  '※': [2, -2, false, 'note'], '*': [3, -2, false, 'note'],
};
const WIDE = /[□■○◦ㅇ※]/;

function marker(s) {
  const c = s[0];
  if (!MARKERS[c]) return null;
  if ((c === '-' || c === '*' || c === 'ㅇ') && s[1] !== ' ') return null; // "-1", "*중요*", "ㅇㅇ" 은 기호 아님
  return MARKERS[c];
}

function parseRuns(s) {
  const out = [];
  let last = 0;
  for (const m of s.matchAll(/\*\*(.+?)\*\*/g)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

// ── writer ────────────────────────────────────────────────────────────────
// 커서 `p`는 항상 비어 있는 본문 문단(구역 0)을 가리킨다. 문단을 쓰면 끝에서 갈라 다음 빈 문단을 만든다.
export class Writer {
  constructor(doc, theme = {}, p = 0) {
    this.doc = doc;
    this.t = { ...THEME, ...theme };
    this.p = p;
    this.s = 0; // 구역
    this.fonts = {};
    this.breakNext = false;
    this.fig = { table: 0, figure: 0 };
    this.ctrlParas = new Set(); // 표·그림이 든 문단 (길이 0으로 보임)
    const d = J(doc.getPageDef(0));
    this.bodyW = d.width - d.marginLeft - d.marginRight - (d.marginGutter || 0);
  }
  font(key) {
    const name = this.t[key] ?? key;
    return (this.fonts[name] ??= this.doc.findOrCreateFontId(name));
  }
  char(o) {
    return JSON.stringify({ bold: false, italic: false, underline: false, textColor: '#000000', ...o });
  }
  para(o) {
    return JSON.stringify({ alignment: 'justify', marginLeft: 0, indent: 0, spacingBefore: 0, spacingAfter: 0, lineSpacing: this.t.lineSpacing, lineSpacingType: 'Percent', keepWithNext: false, pageBreakBefore: false, ...o });
  }
  takeBreak() {
    const b = this.breakNext;
    this.breakNext = false;
    return b;
  }

  // 문단 하나. **굵게** 지원
  write(text, { char = {}, para = {} } = {}) {
    const { doc, p } = this;
    const runs = parseRuns(text);
    const plain = runs.map((r) => r.text).join('');
    const n = len(plain);
    if (n) J(doc.insertText(this.s, p, 0, plain));
    J(doc.applyParaFormat(this.s, p, this.para({ ...para, pageBreakBefore: this.takeBreak() })));
    if (n) {
      J(doc.applyCharFormat(this.s, p, 0, n, this.char(char)));
      let at = 0;
      for (const r of runs) {
        const k = len(r.text);
        if (r.bold) J(doc.applyCharFormat(this.s, p, at, at + k, JSON.stringify({ bold: true })));
        at += k;
      }
    }
    J(doc.splitParagraph(this.s, p, n));
    this.p = p + 1;
  }

  // □ ○ - · ※ 기호로 수준·서체·내어쓰기를 정한다
  line(raw) {
    const s = raw.trim();
    const size = this.t.size;
    const m = marker(s);
    if (!m) return this.write(s, { char: { fontId: this.font('body'), fontSize: size * 100 }, para: { spacingBefore: 2 * PT } });
    const [lvl, dSize, bold, fontKey] = m;
    const pt = size + dSize;
    const hang = (WIDE.test(s[0]) ? 1.35 : 0.85) * pt; // 둘째 줄이 기호 뒤 글자에 맞도록
    this.write(s, {
      char: { fontId: this.font(fontKey), fontSize: pt * 100, bold },
      para: { marginLeft: Math.round((lvl * size + hang) * PT), indent: Math.round(-hang * PT), spacingBefore: [12, 5, 2, 1][lvl] * PT, keepWithNext: lvl === 0 },
    });
  }

  heading(text, level) {
    const pt = level === 1 ? 16 : 14;
    this.write(text, {
      char: { fontId: this.font('head'), fontSize: pt * 100 },
      para: { alignment: 'left', spacingBefore: (level === 1 ? 16 : 12) * PT, spacingAfter: 4 * PT, keepWithNext: true },
    });
  }

  blank(pt = 6) {
    // 글자 크기 상한 때문에 큰 여백은 여러 줄로 나눈다
    for (let left = pt; left > 0; left -= 40) this.write(' ', { char: { fontSize: Math.min(left, 40) * 100 }, para: { lineSpacing: 100 } });
  }

  caption(text, kind) {
    const label = kind === 'table' ? '표' : '그림';
    const s = /^[<〈[]/.test(text) ? text : `<${label} ${++this.fig[kind]}> ${text}`;
    this.write(s, {
      char: { fontId: this.font('table'), fontSize: (this.t.size - 2) * 100, bold: kind === 'table' },
      para: { alignment: 'center', spacingBefore: (kind === 'table' ? 8 : 2) * PT, spacingAfter: 3 * PT, keepWithNext: kind === 'table' },
    });
  }

  // 빈 문단 p 에 표를 만든다. rows[r][c] = 문자열(줄바꿈·기호 허용). 병합으로 가려진 칸 내용은 무시된다.
  table(spec) {
    const { doc, t } = this;
    const rows = [...(spec.header ? [spec.header] : []), ...(spec.rows || [])];
    if (!rows.length) return warn(`table: 빈 표 ${spec.caption || ''}`);
    const nc = Math.max(...rows.map((r) => r.length));
    const w = spec.widths || Array(nc).fill(1);
    const total = w.reduce((a, b) => a + b, 0);
    const width = Math.round(this.bodyW * (spec.width ?? 1)) - 400;
    const colWidths = w.map((x) => Math.floor((width * x) / total));
    if (spec.caption) this.caption(spec.caption, 'table');
    J(doc.applyParaFormat(this.s, this.p, this.para({ alignment: 'center', lineSpacing: 100, spacingBefore: (spec.before ?? 0) * PT, pageBreakBefore: this.takeBreak() })));
    J(doc.splitParagraph(this.s, this.p, 0)); // 표 문단은 길이가 0으로 잡혀 끝에서 가를 수 없다 — 다음 빈 문단을 먼저 만든다
    const r = J(doc.createTableEx(JSON.stringify({ sectionIdx: this.s, paraIdx: this.p, charOffset: 0, rowCount: rows.length, colCount: nc, treatAsChar: true, colWidths })));
    const pp = r.paraIdx;
    const ctrl = r.controlIdx;
    for (const [r1, c1, r2, c2] of spec.merge || []) J(doc.mergeTableCells(this.s, pp, ctrl, r1, c1, r2, c2));
    const cells = J(doc.getTableDimensions(this.s, pp, ctrl)).cellCount;
    const align = spec.align || '';
    for (let cell = 0; cell < cells; cell++) {
      const { row, col } = J(doc.getCellInfo(this.s, pp, ctrl, cell));
      const head = (spec.header && row === 0) || (spec.sideHeader && col === 0);
      const props = { verticalAlign: 1, applyInnerMargin: true, paddingLeft: 510, paddingRight: 510, paddingTop: 280, paddingBottom: 280 };
      const fill = head ? t.headerFill : spec.fills?.[`${row},${col}`];
      if (fill) Object.assign(props, { fillType: 'solid', fillColor: fill, patternType: -1 });
      if (spec.line) for (const k of ['borderLeft', 'borderRight', 'borderTop', 'borderBottom']) props[k] = { type: 1, width: 1, color: spec.line };
      J(doc.setCellProperties(this.s, pp, ctrl, cell, JSON.stringify(props)));
      const text = rows[row]?.[col];
      if (text != null && text !== '') {
        fillCell(this, { pp, ctrl, cell }, String(text), {
          bold: head,
          align: head ? 'center' : { l: 'left', c: 'center', r: 'right' }[align[col]] || 'left',
          size: spec.size ?? t.size - 2,
          font: spec.font,
          color: spec.color,
        });
      }
    }
    this.p = pp + 1;
    this.ctrlParas.add(pp);
    if (spec.note) {
      this.write(spec.note, { char: { fontId: this.font('note'), fontSize: (t.size - 3) * 100 }, para: { alignment: 'right', spacingBefore: 2 * PT } });
    } else if (!spec.tight) this.blank(4);
    return { pp, ctrl };
  }

  // 한 칸짜리 상자: 핵심 요약 / 작성요령 / 표지 제목
  box(lines, { title, fill, line, color, size, font, align, before = 4 } = {}) {
    const text = [...(title ? [`**${title}**`] : []), ...lines].join('\n');
    return this.table({ rows: [[text]], fills: { '0,0': fill ?? this.t.soft }, line: line ?? this.t.accent, color, size: size ?? this.t.size - 1, font, align: align ?? 'l', before });
  }

  // 장 제목: [Ⅰ | 사업 개요] 두 칸 띠
  chapter(text) {
    const m = /^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|\d+|[IVX]+)[.)]?\s+(.+)$/.exec(text);
    if (!m) return this.heading(text, 1);
    const { pp, ctrl } = this.table({ widths: [1, 11], rows: [[m[1], m[2]]], line: this.t.accent, fills: { '0,0': this.t.accent }, size: 16, font: 'head', tight: true, before: 14 });
    fillCell(this, { pp, ctrl, cell: 0 }, m[1], { align: 'center', size: 16, font: 'head', color: '#FFFFFF' });
    fillCell(this, { pp, ctrl, cell: 1 }, m[2], { align: 'left', size: 16, font: 'head' });
    this.blank(4);
  }

  // 표지: 위 여백 → 제목 상자 → (아래쪽) 기관·날짜. 쪽 맨 위 spacingBefore는 무시되므로 빈 문단 높이로 민다
  title({ text, sub, org, date }) {
    this.blank(120);
    const lines = [`**${text}**`, ...(sub ? [sub] : [])];
    const { pp, ctrl } = this.box(lines, { fill: '#FFFFFF', align: 'c', size: 22, font: 'head', before: 0 });
    if (sub) J(this.doc.applyCharFormatInCell(this.s, pp, ctrl, 0, 1, 0, len(sub), this.char({ fontId: this.font('body'), fontSize: 1500 })));
    if (!org && !date) return;
    this.blank(260);
    for (const s of [date, org].filter(Boolean)) this.write(s, { char: { fontId: this.font('head'), fontSize: 1600 }, para: { alignment: 'center', spacingBefore: 6 * PT } });
    this.breakNext = true;
  }

  image(spec, base) {
    const file = path.resolve(base, spec.path);
    if (!fs.existsSync(file)) return warn(`image: 파일 없음 ${spec.path}`);
    const data = new Uint8Array(fs.readFileSync(file));
    const dim = imageSize(data);
    if (!dim) return warn(`image: PNG/JPEG만 지원 ${spec.path}`);
    const width = Math.min(this.bodyW, Math.round((spec.width ?? 150) * 283.465)); // mm → HWPUNIT
    const height = Math.round((width * dim.h) / dim.w);
    J(this.doc.applyParaFormat(this.s, this.p, this.para({ alignment: 'center', lineSpacing: 100, spacingBefore: 6 * PT, pageBreakBefore: this.takeBreak() })));
    J(this.doc.splitParagraph(this.s, this.p, 0));
    J(this.doc.insertPictureEx(JSON.stringify({ sectionIdx: this.s, paraIdx: this.p, charOffset: 0, width, height, naturalWidthPx: dim.w, naturalHeightPx: dim.h, extension: dim.ext, description: spec.caption || '' }), data));
    J(this.doc.setPictureProperties(this.s, this.p, 0, JSON.stringify({ treatAsChar: true }))); // 글자처럼 취급 → 문단 흐름 안에 둔다
    this.ctrlParas.add(this.p++);
    if (spec.caption) this.caption(spec.caption, 'figure');
  }

  block(b, base) {
    switch (b.type) {
      case 'title': return this.title(b);
      case 'chapter': return this.chapter(b.text);
      case 'h1': return this.heading(b.text, 1);
      case 'h2': return this.heading(b.text, 2);
      case 'text': return [].concat(b.lines ?? b.text).flatMap((l) => l.split('\n')).forEach((l) => (l.trim() ? this.line(l) : this.blank()));
      case 'table': return this.table(b);
      case 'box': return this.box([].concat(b.lines ?? b.text), { title: b.title });
      case 'guide': return this.box([].concat(b.lines ?? b.text), { title: b.title ?? '< 작성요령 >', color: this.t.guide, line: this.t.guide, fill: '#FFFFFF' });
      case 'image': return this.image(b, base);
      case 'pagebreak': this.breakNext = true; return;
      default: warn(`알 수 없는 블록: ${JSON.stringify(b).slice(0, 60)}`);
    }
  }

  // 마지막 빈 문단 정리
  finish() {
    const n = this.doc.getParagraphCount(0);
    if (n > 1 && this.p === n - 1 && !this.ctrlParas.has(this.p) && this.doc.getParagraphLength(this.s, this.p) === 0) J(this.doc.deleteParagraph(this.s, this.p));
  }
}

// 표 셀 채우기 — 여러 줄(\n), 기호 들여쓰기, **굵게**. 기존 내용은 지운다.
export function fillCell(w, { pp, ctrl, cell }, text, { bold = false, align = 'left', size, font = 'table', color } = {}) {
  const { doc } = w;
  size ??= w.t.size - 2;
  const last = doc.getCellParagraphCount(w.s, pp, ctrl, cell) - 1;
  const end = doc.getCellParagraphLength(w.s, pp, ctrl, cell, last);
  if (last > 0 || end > 0) J(doc.deleteRangeInCell(w.s, pp, ctrl, cell, 0, 0, last, end));
  const lines = String(text).split('\n');
  lines.forEach((raw, i) => {
    if (i) J(doc.splitParagraphInCell(w.s, pp, ctrl, cell, i - 1, doc.getCellParagraphLength(w.s, pp, ctrl, cell, i - 1)));
    const runs = parseRuns(raw.trim());
    const plain = runs.map((r) => r.text).join('');
    const m = marker(plain);
    const hang = m ? (WIDE.test(plain[0]) ? 1.35 : 0.85) * size : 0;
    const left = m ? Math.max(0, m[0] - 1) * size * 0.8 + hang : 0;
    J(doc.applyParaFormatInCell(w.s, pp, ctrl, cell, i, w.para({ alignment: m ? 'left' : align, marginLeft: Math.round(left * PT), indent: Math.round(-hang * PT), lineSpacing: 130 })));
    const k = len(plain);
    if (!k) return;
    J(doc.insertTextInCell(w.s, pp, ctrl, cell, i, 0, plain));
    J(doc.applyCharFormatInCell(w.s, pp, ctrl, cell, i, 0, k, w.char({ fontId: w.font(font), fontSize: Math.round(size * 100), bold, ...(color && { textColor: color }) })));
    let at = 0;
    for (const r of runs) {
      const q = len(r.text);
      if (r.bold) J(doc.applyCharFormatInCell(w.s, pp, ctrl, cell, i, at, at + q, JSON.stringify({ bold: true })));
      at += q;
    }
  });
}

function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { ext: 'png', w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9; ) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { ext: 'jpg', h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

// ── read ──────────────────────────────────────────────────────────────────
function paraText(doc, s, p) {
  const n = doc.getParagraphLength(s, p);
  return n ? doc.getTextRange(s, p, 0, n) : '';
}
function cellText(doc, s, pp, ctrl, cell) {
  const n = doc.getCellParagraphCount(s, pp, ctrl, cell);
  const out = [];
  for (let i = 0; i < n; i++) out.push(doc.getTextInCell(s, pp, ctrl, cell, i, 0, doc.getCellParagraphLength(s, pp, ctrl, cell, i)));
  return out.join('\n').trim();
}

// 표 하나 → {rows, cols, cells:[{cell,row,col,rowSpan,colSpan,text}]}
function readTable(doc, s, pp, ctrl) {
  const { rowCount, colCount, cellCount } = J(doc.getTableDimensions(s, pp, ctrl));
  const cells = [];
  for (let cell = 0; cell < cellCount; cell++) cells.push({ cell, ...J(doc.getCellInfo(s, pp, ctrl, cell)), text: cellText(doc, s, pp, ctrl, cell) });
  return { rows: rowCount, cols: colCount, cells };
}

// 본문 순서대로 [{kind:'p', para, text} | {kind:'table', para, ctrl, ...}] (구역 0..n)
// ponytail: 표 안의 표(중첩)는 바깥 셀 텍스트로만 읽힌다. 필요하면 *ByPath API로 확장
export function walk(doc) {
  const out = [];
  const tables = new Map(); // getControls의 para는 구역을 이어 붙인 전역 번호
  for (const c of J(doc.getControls())) if (c.ctrlId === 'tbl' && c.list === 0) tables.set(c.para, [...(tables.get(c.para) || []), c.controlIndex]);
  const sections = J(doc.getDocumentInfo()).sectionCount;
  for (let s = 0, base = 0; s < sections; s++) {
    const n = doc.getParagraphCount(s);
    for (let p = 0; p < n; p++) {
      const text = paraText(doc, s, p).replace(/[\u0000-\u001f]/g, '').trim();
      if (text) out.push({ kind: 'p', sec: s, para: p, text });
      for (const ctrl of tables.get(base + p) || []) {
        try {
          out.push({ kind: 'table', sec: s, para: p, ctrl, ...readTable(doc, s, p, ctrl) });
        } catch {
          /* 글상자 속 표 등 본문 경로로 닿지 않는 표 */
        }
      }
    }
    base += n;
  }
  return out;
}

function toMarkdown(items) {
  const esc = (s) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const lines = [];
  for (const it of items) {
    if (it.kind === 'p') { lines.push(it.text); continue; }
    lines.push('', `<!-- table sec=${it.sec} para=${it.para} ctrl=${it.ctrl} (${it.rows}×${it.cols}) -->`);
    const grid = Array.from({ length: it.rows }, () => Array(it.cols).fill(''));
    for (const c of it.cells) {
      for (let r = 0; r < c.rowSpan; r++) for (let k = 0; k < c.colSpan; k++) {
        if (grid[c.row + r]) grid[c.row + r][c.col + k] = r || k ? '' : esc(c.text); // 병합으로 가려진 칸은 비움
      }
    }
    grid.forEach((row, i) => {
      lines.push(`| ${row.join(' | ')} |`);
      if (i === 0) lines.push(`|${' --- |'.repeat(it.cols)}`);
    });
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── fill ──────────────────────────────────────────────────────────────────
const norm = (s) => s.replace(/\s+/g, '');

const at = (t, r, c) => t.cells.find((x) => x.row <= r && r < x.row + x.rowSpan && x.col <= c && c < x.col + x.colSpan);

// 라벨 칸의 오른쪽(below면 아래) 칸, 또는 주소(para·ctrl·row·col) 칸을 채운다
function fillByLabel(w, doc, { label, text, below = false, nth = 1, sec = 0, para, ctrl = 0, row, col }) {
  let seen = 0;
  for (const t of walk(doc)) {
    if (t.kind !== 'table') continue;
    if (label == null) {
      if (t.sec !== sec || t.para !== para || t.ctrl !== ctrl) continue;
      const target = at(t, row, col);
      if (!target) return warn(`fill.cells: para=${para} (${row},${col}) 칸 없음`);
      return keepStyleFill(w, doc, t, target, text);
    }
    for (const c of t.cells) {
      if (norm(c.text) !== norm(label) || ++seen < nth) continue;
      const target = below ? at(t, c.row + c.rowSpan, c.col) : at(t, c.row, c.col + c.colSpan);
      if (!target) return warn(`fill.cells: '${label}' 옆 칸 없음`);
      return keepStyleFill(w, doc, t, target, text);
    }
  }
  warn(`fill.cells: ${label != null ? `라벨 '${label}'` : `표 para=${para}`} 을 찾지 못함`);
}

function keepStyleFill(w, doc, t, target, text) {
  // 양식 칸의 원래 서체·크기를 유지한다. 빈 칸은 앞 문단 모양을 물려받아 믿을 수 없으므로 표 기본값을 쓴다
  w.s = t.sec;
  if (!target.text) return fillCell(w, { pp: t.para, ctrl: t.ctrl, cell: target.cell }, text, {});
  const cp = J(doc.getCellCharPropertiesAt(t.sec, t.para, t.ctrl, target.cell, 0, 0));
  const align = J(doc.getCellParaPropertiesAt(t.sec, t.para, t.ctrl, target.cell, 0)).alignment;
  const size = cp.fontSize >= 800 ? cp.fontSize / 100 : undefined; // 빈 칸은 크기가 이상하게 작게 잡히기도 한다
  fillCell(w, { pp: t.para, ctrl: t.ctrl, cell: target.cell }, text, { size, font: cp.fontFamily, align });
}

// 양식의 자리표시 줄: 비어 있거나 기호 하나만 있는 문단 (ㅇ, -, *, ‧, □ …)
const PLACEHOLDER = /^[\sㅇo○◦□■\-‧·•*※]*$/;


export function fill(doc, spec, base) {
  const w = new Writer(doc, spec.theme);
  // 새로 넣는 표는 양식의 기존 표 폭에 맞춘다 (양식 표는 보통 본문 폭보다 좁다)
  const widths = J(doc.getControls()).filter((c) => c.ctrlId === 'tbl' && c.list === 0).map((c) => c.props.Width);
  if (widths.length) w.bodyW = Math.min(w.bodyW, Math.max(...widths) + 400);
  for (const [name, value] of Object.entries(spec.fields || {})) {
    try {
      if (!JSON.parse(doc.setFieldValueByName(name, value)).ok) warn(`fill.fields: '${name}' 없음`);
    } catch {
      warn(`fill.fields: '${name}' 없음`); // 없는 이름이면 rhwp가 예외를 던진다
    }
  }
  for (const c of spec.cells || []) fillByLabel(w, doc, c);
  for (const r of spec.replace || []) {
    // ponytail: 항상 전체 치환 (replaceOne은 본문 커서 기준이라 표 안 문구를 못 찾는다)
    const res = JSON.parse(doc.replaceAll(r.find, r.with ?? '', true));
    if (!res.count) warn(`fill.replace: '${r.find}' 없음`);
  }
  // 작성요령 상자 지우기: 해당 문구가 든 표를 통째로
  for (const needle of spec.removeTables || []) {
    const hits = walk(doc).filter((t) => t.kind === 'table' && t.cells.some((c) => norm(c.text).includes(norm(needle)))).reverse();
    for (const t of hits) {
      J(doc.deleteTableControl(t.sec, t.para, t.ctrl));
      // 표만 있던 문단이 빈 줄로 남으면 지운다
      const blank = (q) => q >= 0 && q < doc.getParagraphCount(t.sec) && !paraText(doc, t.sec, q).trim() && J(doc.getControlTextPositions(t.sec, q)).length === 0;
      if (blank(t.para)) J(doc.deleteParagraph(t.sec, t.para));
      // 앞뒤로 빈 줄이 겹치면 하나만 남긴다
      if (blank(t.para - 1) && blank(t.para)) J(doc.deleteParagraph(t.sec, t.para));
    }
    if (!hits.length) warn(`fill.removeTables: '${needle}' 든 표 없음`);
  }
  // 앵커 문단 뒤에 블록 삽입 (뒤에서부터 넣어야 앞쪽 번호가 안 밀린다)
  const inserts = (spec.insert || []).map((ins) => {
    const hit = walk(doc).find((it) => it.kind === 'p' && norm(it.text).includes(norm(ins.after)));
    if (!hit) warn(`fill.insert: 앵커 '${ins.after}' 없음`);
    return hit && { ...ins, sec: hit.sec, para: hit.para };
  }).filter(Boolean).sort((a, b) => b.sec - a.sec || b.para - a.para);
  for (const ins of inserts) {
    const { sec, para } = ins;
    w.s = sec;
    w.ctrlParas = new Set(); // 이전 삽입의 문단 번호는 여기서 의미가 없다
    // 앵커 바로 뒤의 자리표시 줄(ㅇ, -, * …)을 지운다. 표·그림 문단에서 멈춘다
    if (ins.dropPlaceholders !== false) {
      while (para + 1 < doc.getParagraphCount(sec) && J(doc.getControlTextPositions(sec, para + 1)).length === 0 && PLACEHOLDER.test(paraText(doc, sec, para + 1))) {
        J(doc.deleteParagraph(sec, para + 1));
      }
    }
    J(doc.splitParagraph(sec, para, doc.getParagraphLength(sec, para))); // 앵커 뒤 빈 문단 = 커서
    w.p = para + 1;
    for (const b of ins.blocks) w.block(b, base);
    if (doc.getParagraphLength(sec, w.p) === 0 && !w.ctrlParas.has(w.p)) J(doc.deleteParagraph(sec, w.p));
  }
}

// ── render ────────────────────────────────────────────────────────────────
function render(doc, out, pages) {
  fs.mkdirSync(out, { recursive: true });
  const n = doc.pageCount();
  const [a, b] = pages ? pages.split('-').map(Number) : [1, n];
  const files = [];
  for (let i = a - 1; i < Math.min(b ?? a, n); i++) {
    const svg = path.join(out, `page-${String(i + 1).padStart(2, '0')}.svg`);
    fs.writeFileSync(svg, doc.renderPageSvg(i));
    try {
      execFileSync('rsvg-convert', ['-w', '1240', '-b', 'white', svg, '-o', svg.replace(/svg$/, 'png')]);
      fs.unlinkSync(svg);
      files.push(svg.replace(/svg$/, 'png'));
    } catch {
      files.push(svg);
    }
  }
  if (files.some((f) => f.endsWith('.svg'))) console.error('[mega-hwp] rsvg-convert 없음 → SVG로 남김 (brew install librsvg)');
  return files;
}

// ── cli ───────────────────────────────────────────────────────────────────
// 한컴은 파일에 저장된 줄 배치(lineseg)를 그대로 믿고 다시 조판하지 않는다. rhwp가 만든 줄 배치에는
// 문단 들여쓰기·내어쓰기가 빠져 있어서(□○- 둘째 줄이 왼쪽 끝으로 붙음) HWPX에서 줄 배치를 모두 지우고
// 한컴이 열 때 직접 조판하게 한다. .hwp가 필요하면 줄 배치 없는 HWPX를 다시 읽어 HWP로 내보낸다.
function stripLinesegs(hwpx) {
  const files = unzipSync(hwpx);
  const out = { mimetype: [files.mimetype, { level: 0 }] }; // mimetype은 맨 앞, 무압축
  for (const [name, data] of Object.entries(files)) {
    if (name === 'mimetype') continue;
    out[name] = /^Contents\/section\d+\.xml$/.test(name)
      ? strToU8(strFromU8(data).replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, ''))
      : data;
  }
  return zipSync(out);
}

function save(core, doc, out) {
  const hwpx = stripLinesegs(doc.exportHwpx());
  const bytes = out.endsWith('.hwpx') ? hwpx : new core.HwpDocument(hwpx).exportHwp();
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, bytes);
  const back = new core.HwpDocument(new Uint8Array(bytes));
  if (back.pageCount() < 1 || walk(back).length !== walk(doc).length) warn('저장 검증 실패: 다시 연 문서의 문단·표 수가 다름');
}

export async function main(argv) {
  WARN.length = 0;
  const args = [...argv];
  const opt = (k) => {
    const i = args.indexOf(k);
    return i < 0 ? undefined : args.splice(i, 2)[1];
  };
  const out = opt('-o');
  const pages = opt('--pages');
  const [cmd, a, b] = args;
  const core = await loadCore();
  const open = (f) => new core.HwpDocument(new Uint8Array(fs.readFileSync(f)));

  if (cmd === 'text') {
    const md = toMarkdown(walk(open(a)));
    if (out) fs.writeFileSync(out, md);
    else process.stdout.write(md + '\n');
  } else if (cmd === 'build') {
    const spec = JSON.parse(fs.readFileSync(a, 'utf8'));
    const doc = core.HwpDocument.createEmpty();
    doc.createBlankDocument();
    const w = new Writer(doc, spec.theme);
    for (const blk of spec.blocks) w.block(blk, path.dirname(path.resolve(a)));
    w.finish();
    const target = out || a.replace(/\.json$/, '.hwp');
    save(core, doc, target);
    console.log(`${target} — ${doc.pageCount()}쪽`);
  } else if (cmd === 'fill') {
    const doc = open(a);
    fill(doc, JSON.parse(fs.readFileSync(b, 'utf8')), path.dirname(path.resolve(b)));
    const target = out || a.replace(/(\.hwpx?)$/, '.filled$1');
    save(core, doc, target);
    console.log(`${target} — ${doc.pageCount()}쪽`);
  } else if (cmd === 'hancom') {
    // macOS + 한컴오피스: 실제 한컴 화면을 쪽마다 캡처 (scripts/hancom.swift)
    const dir = out || a.replace(/\.hwpx?$/, '') + '-hancom';
    const screens = String(open(a).pageCount() * 2 + 2);
    execFileSync('swift', [path.join(SKILL, 'scripts/hancom.swift'), path.resolve(a), path.resolve(dir), screens], { stdio: 'inherit' });
  } else if (cmd === 'render') {
    const doc = open(a);
    const files = render(doc, out || a.replace(/\.hwpx?$/, ''), pages);
    console.log(files.join('\n'));
  } else {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n'));
    process.exitCode = 1;
  }
  for (const m of WARN) console.error(`WARN ${m}`);
  return [...WARN];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.stack || e);
    process.exit(1);
  });
}
