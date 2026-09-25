// node tests/test.mjs — build·fill·text 왕복 검사
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, loadCore, walk } from '../skills/mega-hwp/scripts/hwp.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mega-hwp-'));
const core = await loadCore();
const open = (f) => new core.HwpDocument(new Uint8Array(fs.readFileSync(f)));
const text = (f) => walk(open(f)).map((it) => (it.kind === 'p' ? it.text : it.cells.map((c) => c.text).join('|'))).join('\n');

// 1. sample.json → .hwp / .hwpx, 경고 0, 다시 열어 모든 블록 확인
const sample = path.join(root, 'skills/mega-hwp/examples/sample.json');
for (const ext of ['hwp', 'hwpx']) {
  const out = path.join(tmp, `sample.${ext}`);
  const warns = await main(['build', sample, '-o', out]);
  assert.deepEqual(warns, [], `${ext} 경고`);
  const items = walk(open(out));
  const tables = items.filter((i) => i.kind === 'table');
  assert.equal(tables.length, 12, `${ext} 표 개수 (표지·장 3·요약·표 6·작성요령)`);
  const t = text(out);
  for (const s of ['온디바이스 LLM', '사업 개요', '핵심 요약', '□ 추진 배경', '⇒ 개인정보', '상담 초안 작성 시간', '4.2점 이상', '사업비중(%)', '작성요령']) assert.ok(t.includes(s), `${ext}: '${s}' 없음`);
  assert.ok(!t.includes('**'), `${ext}: 굵게 표시 ** 가 남음`);
  // 한컴은 patternType 0을 '가로줄 무늬'로 그린다. 단색 채우기는 실제 한글 파일처럼 -1(무늬 없음)이어야 한다
  const doc = open(out);
  for (const t of tables) for (const c of t.cells) {
    const p = JSON.parse(doc.getCellProperties(t.sec, t.para, t.ctrl, c.cell));
    if (p.fillType !== 'none') assert.equal(p.patternType, -1, `${ext}: 칸 배경에 무늬 (${c.text.slice(0, 10)})`);
  }
  // 한컴은 저장된 줄 배치(lineseg)를 믿고 다시 조판하지 않는다 — rhwp 줄 배치엔 내어쓰기가 빠져 있으므로 남기면 안 된다
  if (ext === 'hwpx') {
    const { unzipSync, strFromU8 } = await import(path.join(root, 'skills/mega-hwp/node_modules/fflate/esm/index.mjs'));
    const xml = strFromU8(unzipSync(new Uint8Array(fs.readFileSync(out)))['Contents/section0.xml']);
    assert.ok(!xml.includes('linesegarray'), 'hwpx: lineseg가 남음');
  }
  const goal = tables.find((x) => x.cells.some((c) => c.text === '평가비중(%)'));
  assert.equal(goal.cells.find((c) => c.text === '정량').rowSpan, 3, '병합');
}

// 2. 양식 채우기: 라벨 칸, 주소 칸, 앵커 뒤 삽입 + 자리표시 삭제, 작성요령 표 삭제, 치환
const form = path.join(tmp, 'form.json');
fs.writeFileSync(form, JSON.stringify({ blocks: [
  { type: 'table', rows: [['과업명', ''], ['기업명', '‘주식회사’ 제외하고 기재']] },
  { type: 'h2', text: '1. 사업목표' },
  { type: 'guide', lines: ['- 목표를 적는다'] },
  { type: 'text', lines: ['ㅇ ', '- ', '* '] },
  { type: 'h2', text: '2. 기타' },
] }));
await main(['build', form, '-o', path.join(tmp, 'form.hwp')]);
const fillSpec = path.join(tmp, 'fill.json');
fs.writeFileSync(fillSpec, JSON.stringify({
  cells: [{ label: '과업명', text: '예약 시스템' }, { para: 0, ctrl: 2, row: 1, col: 1, text: '메가투어' }],
  replace: [{ find: '기타', with: '기타 사항' }],
  removeTables: ['작성요령'],
  fields: { 없는누름틀: 'x' },
  insert: [{ after: '1. 사업목표', blocks: [{ type: 'text', lines: ['○ 예약 완료율 55% 달성'] }] }],
}));
const filled = path.join(tmp, 'filled.hwp');
assert.deepEqual(await main(['fill', path.join(tmp, 'form.hwp'), fillSpec, '-o', filled]), ["fill.fields: '없는누름틀' 없음"]);
const lines = text(filled).split('\n');
assert.equal(lines[0], '과업명|예약 시스템|기업명|메가투어');
assert.deepEqual(lines.slice(1), ['1. 사업목표', '○ 예약 완료율 55% 달성', '2. 기타 사항']);

// 3. 그림: 저장 후 다시 열어도 그림 컨트롤이 남아 있어야 한다
const imgSpec = path.join(tmp, 'img.json');
fs.writeFileSync(imgSpec, JSON.stringify({ blocks: [
  { type: 'text', lines: ['□ 그림 앞'] },
  { type: 'image', path: path.join(root, 'gallery/assets/concept.png'), width: 120, caption: '구성도' },
] }));
for (const ext of ['hwp', 'hwpx']) {
  const out = path.join(tmp, `img.${ext}`);
  assert.deepEqual(await main(['build', imgSpec, '-o', out]), []);
  assert.equal(JSON.parse(open(out).getControls()).filter((c) => c.ctrlId === 'gso').length, 1, `${ext}: 그림 없음`);
  assert.ok(text(out).includes('< 구성도 >'), `${ext}: 그림 번호`);
}

// 4. lint: 예시 문서는 실제 문서 기준을 모두 통과, 흔한 AI 초안(긴 □, 숫자·화살표 남발)은 걸린다
const { lint } = await import('../skills/mega-hwp/scripts/hwp.mjs');
for (const f of ['skills/mega-hwp/examples/sample.json', 'gallery/result.json', 'gallery/midterm.json', 'gallery/press.json']) {
  const res = lint(JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.ok(res.every((r) => r.startsWith('OK')), `${f}: ${res.filter((r) => r.startsWith('NG')).join(', ')}`);
}
const bad = lint({ blocks: [{ type: 'text', lines: ['□ 공공 민원 상담은 개인정보 때문에 클라우드 LLM 도입이 어려워 온디바이스 추론이 필요함', '○ (배경) 상담 기록의 73%가 민감정보 → 외부 전송 불가, 2025년 조사 기준 12개 기관'] }] });
assert.equal(bad.filter((r) => r.startsWith('NG')).length >= 4, true, 'lint가 AI 초안 패턴을 잡아야 함');

console.log(`ok — ${tmp}`);
