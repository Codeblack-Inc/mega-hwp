// 갤러리 사이트 빌드: 예시 문서 → .hwp/.hwpx + 쪽 PNG + data.json
// node gallery/build.mjs [outdir=site]   (rsvg-convert 필요)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../skills/mega-hwp/scripts/hwp.mjs';
import { DELIVERABLES, GROUPS } from './deliverables.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SKILL = path.join(ROOT, 'skills/mega-hwp');
const OUT = path.resolve(ROOT, process.argv[2] || 'site');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'files'), { recursive: true });

async function run(args) {
  const warns = await main(args);
  if (warns.length) throw new Error(`${args.join(' ')}\n${warns.join('\n')}`);
}

// 문서 하나 → hwp·hwpx + 쪽 이미지
async function doc(key, build) {
  const hwp = path.join(OUT, 'files', `${key}.hwp`);
  await build(hwp, ['--render']); // → files/<key>/page-NN.png (저장 전 문서로 렌더)
  await build(hwp.replace(/hwp$/, 'hwpx'), []);
  const dir = path.join(OUT, 'img', key);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.renameSync(hwp.replace(/\.hwp$/, ''), dir);
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => `img/${key}/${f}`);
  if (pages.some((p) => !p.endsWith('.png'))) throw new Error('rsvg-convert가 필요합니다');
  return { pages, files: [`files/${key}.hwp`, `files/${key}.hwpx`] };
}
const src = (f) => fs.readFileSync(f, 'utf8').trim();
const fromJson = (json) => (out, extra) => run(['build', json, '-o', out, ...extra]);

const sample = path.join(SKILL, 'examples/sample.json');
const form = path.join(HERE, 'form.json');
const fill = path.join(HERE, 'fill.json');
const report = path.join(HERE, 'report.json');
const result = path.join(HERE, 'result.json');
const midterm = path.join(HERE, 'midterm.json');
const minutes = path.join(HERE, 'minutes.json');
const press = path.join(HERE, 'press.json');
const formHwp = path.join(OUT, 'files', 'form.hwp');

const plan = await doc('plan', fromJson(sample));
const blank = await doc('form', fromJson(form));
const filled = await doc('filled', (out, extra) => run(['fill', formHwp, fill, '-o', out, ...extra]));
const monthly = await doc('report', fromJson(report));
const figures = await doc('result', fromJson(result));
const interim = await doc('midterm', fromJson(midterm));
const meeting = await doc('minutes', fromJson(minutes));
const release = await doc('press', fromJson(press));
// 전체 분량 예시: 가상 과제 Jev의 사업수행계획서·결과보고서 (그림은 mega-diagram으로 그린 투명 PNG와 가상 화면)
const jevPlan = await doc('jev-plan', fromJson(path.join(HERE, 'jev/plan.json')));
const jevResult = await doc('jev-result', fromJson(path.join(HERE, 'jev/result.json')));
// 과제 산출물 예시(가상 과제 Jev·Kora): gallery/<과제>/<key>.json — 목록은 DELIVERABLES
const deliverables = [];
for (const d of DELIVERABLES) {
  const r = await doc(d.key, fromJson(path.join(HERE, d.proj, `${d.key}.json`)));
  deliverables.push({ ...d, r });
}
const head = (f, n = 160) => { const t = src(f).split('\n'); return t.length > n ? t.slice(0, n).join('\n') + `\n… (전체 ${t.length}줄 — GitHub gallery/jev/)` : t.join('\n'); };
await run(['text', formHwp, '-o', path.join(OUT, 'form.md')]);

const hancom = (n) => `${n}쪽(한컴 기준 약 ${Math.round(n * 1.1)}쪽)`;
const items = [
  ...deliverables.map(({ key, proj, name, group, desc, tags, r }) => ({
    key, name, group, desc: `${desc(hancom(r.pages.length))}`,
    tags, variants: [{ key, name: '결과', ...r }],
    code: { label: 'doc.json (앞부분)', text: head(path.join(HERE, proj, `${key}.json`)) },
  })),
  {
    key: 'jev-plan', name: '사업수행계획서', group: 'Jev · 계획·보고',
    desc: `가상 과제 "Jev" 사업수행계획서 전체 ${jevPlan.pages.length}쪽(한컴 기준 약 60쪽). 실증형 사업계획서 표준 목차 Ⅰ~Ⅶ·별첨, 성과목표·평가비중·사업비(천원)·일정·인력·리스크 표, mega-diagram으로 그린 체계도·구성도·흐름도·간트·로드맵과 목표 화면 예시. 계획서라 실적 수치가 없다.`,
    tags: ['chapter', 'h2', 'h3', 'text', 'table', 'image', 'lint'],
    variants: [{ key: 'jev-plan', name: '결과', ...jevPlan }],
    code: { label: 'doc.json (앞부분)', text: head(path.join(HERE, 'jev/plan.json')) },
  },
  {
    key: 'jev-result', name: '최종보고서 (사업결과보고서)', group: 'Jev · 계획·보고',
    desc: `같은 과제의 결과보고서 ${jevResult.pages.length}쪽(한컴 기준 약 100쪽). 전담기관 결과보고서 양식의 Ⅰ~Ⅵ와 ①②③④ 소단원 띠, 계획 대비 실적·부진현황·정량목표 달성현황(평가 비중·달성율)·사업비 집행(집행율) 표, 기관별 실증 화면과 성과 차트. 계획서의 목표·비중을 그대로 인용한다.`,
    tags: ['chapter', 'section', 'h3', 'text', 'table', 'image', 'lint'],
    variants: [{ key: 'jev-result', name: '결과', ...jevResult }],
    code: { label: 'doc.json (앞부분)', text: head(path.join(HERE, 'jev/result.json')) },
  },
  {
    key: 'plan', name: '사업계획서', group: '새 문서',
    desc: '표준 목차(Ⅰ 개요 · Ⅲ 목표·전략 · Ⅴ 관리계획)를 따른 발췌본. 표지와 과제 개요표, 장 제목 띠, 핵심 요약 상자, □ 제목구 · ○ 한 줄 · - 근거의 개조식, ⇒ 결론 한 번, 성과목표·사업비·일정 표, 작성요령 상자.',
    tags: ['title', 'chapter', 'h3', 'box', 'text', 'table', 'guide'],
    variants: [{ key: 'plan', name: '결과', ...plan }],
    code: { label: 'doc.json', text: src(sample) },
  },
  {
    key: 'midterm', name: '중간보고서', group: '새 문서',
    desc: '추진 현황 → 추진성과(계획대비 실적, 주요 성과물) → 부진사업 현황 및 대책 → 향후 계획 → 사업비 집행. 가상 물류센터 AI 비전 검수 실증으로, 부진 1건의 사유·대책·완료 시점과 성과지표 중간 점검 표를 담았습니다.',
    tags: ['title', 'h2', 'h3', 'text', 'table'],
    variants: [{ key: 'midterm', name: '결과', ...interim }],
    code: { label: 'doc.json', text: src(midterm) },
  },
  {
    key: 'result', name: '실증 결과보고서 (그림)', group: '새 문서',
    desc: '전담기관 양식의 ① 과제목표 ② 진행 상황 및 추진실적 ③ 부진현황 및 대책 ④ 자체의견 소단원 띠(section). 계획 대비 실적 표, 부진현황 "해당사항 없음", 결과값(달성율%) 표, 구성도·화면 그림. 그림은 예시를 위해 그린 가상 도식·화면입니다.',
    tags: ['section', 'image', 'chapter', 'text', 'table'],
    variants: [{ key: 'result', name: '결과', ...figures }],
    code: { label: 'doc.json', text: src(result) },
  },
  {
    key: 'report', name: '월간 업무 보고', group: '보고·회의',
    desc: '과제 정보표, 진척도 표, 주요 실적, 기관별 실증 현황, 비목별 집행 표, 다음 달 계획 상자로 구성한 2쪽 보고.',
    tags: ['h1', 'table', 'text', 'box'],
    variants: [{ key: 'report', name: '결과', ...monthly }],
    code: { label: 'doc.json', text: src(report) },
  },
  {
    key: 'minutes', name: '회의 결과 보고', group: '보고·회의',
    desc: '회의 개요 표(일시·장소·참석자·안건), 안건별 □ ○ - 논의 결과, 병합한 결정 사항 표(안건·결정·담당·기한), 향후 일정 표. 가상 컨소시엄 월간 점검 회의.',
    tags: ['h1', 'table', 'text'],
    variants: [{ key: 'minutes', name: '결과', ...meeting }],
    code: { label: 'doc.json', text: src(minutes) },
  },
  {
    key: 'press', name: '보도자료', group: '보고·회의',
    desc: '보도 일시·담당 부서 표, 제목과 부제, 핵심 요약 상자, 본문, 붙임 표. 보도자료는 기자가 그대로 옮겨 쓰는 글이라 본문을 개조식 대신 "~했다" 서술형 문단(기호 없는 줄)으로 씁니다 — 보고서체 규칙의 예외입니다.',
    tags: ['h1', 'box', 'text', 'table', 'pagebreak'],
    variants: [{ key: 'press', name: '결과', ...release }],
    code: { label: 'doc.json', text: src(press) },
  },
  {
    key: 'fill', name: '양식 채우기', group: '양식',
    desc: '작성요령과 ㅇ - * 자리표시가 있는 빈 양식에 fill.json을 적용했습니다. 라벨 옆 칸을 채우고, 제목 뒤에 본문과 표를 넣고, 자리표시 줄과 작성요령 상자를 지웁니다. 양식의 서체와 표 구조는 그대로입니다.',
    tags: ['cells', 'insert', 'removeTables'],
    variants: [{ key: 'filled', name: '채운 결과', ...filled }, { key: 'form', name: '빈 양식', ...blank }],
    code: { label: 'fill.json', text: src(fill) },
  },
  {
    key: 'read', name: '양식 읽기', group: '양식',
    desc: 'text 명령은 .hwp/.hwpx를 마크다운으로 바꿉니다. 병합을 풀어 표로 보여 주고, 표마다 주소(sec·para·ctrl)를 달아 fill.json의 칸 지정에 그대로 씁니다.',
    tags: ['text'],
    variants: [{ key: 'form', name: '원본 양식', ...blank }],
    code: { label: 'text 출력', text: src(path.join(OUT, 'form.md')) },
  },
];

const RANK = ['jev-plan', 'jev-midterm', 'jev-monthly', 'jev-result']; // 계획·보고 묶음은 제출 순서로
const rank = (x) => (RANK.includes(x.key) ? RANK.indexOf(x.key) : 0);
items.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || rank(a) - rank(b)); // 같은 묶음끼리 (sort는 안정 정렬)
if (items.some((x) => !GROUPS.includes(x.group))) throw new Error('GROUPS에 없는 group');
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({ items }));
for (const f of ['index.html', 'mega-hwp.svg', 'symbol.svg', 'guide.html']) fs.copyFileSync(path.join(HERE, f), path.join(OUT, f));
fs.copyFileSync(path.join(ROOT, 'docs/GUIDE.md'), path.join(OUT, 'guide.md'));
console.log(`gallery → ${OUT} (${items.length}개 예시, ${new Set(items.flatMap((i) => i.variants.flatMap((v) => v.pages))).size}쪽)`);
