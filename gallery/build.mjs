// 갤러리 사이트 빌드: 예시 문서 → .hwp/.hwpx + 쪽 PNG + data.json
// node gallery/build.mjs [outdir=site]   (rsvg-convert 필요)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../skills/mega-hwp/scripts/hwp.mjs';

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
const formHwp = path.join(OUT, 'files', 'form.hwp');

const plan = await doc('plan', fromJson(sample));
const blank = await doc('form', fromJson(form));
const filled = await doc('filled', (out, extra) => run(['fill', formHwp, fill, '-o', out, ...extra]));
const monthly = await doc('report', fromJson(report));
const figures = await doc('result', fromJson(result));
await run(['text', formHwp, '-o', path.join(OUT, 'form.md')]);

const items = [
  {
    key: 'plan', name: '사업계획서', group: '새 문서',
    desc: '표지, 장 제목 띠, 핵심 요약 상자, □○-※ 개조식, 병합 표와 표 번호·출처, 일정표, 작성요령 상자. doc.json 하나로 만든 3쪽 문서입니다.',
    tags: ['title', 'chapter', 'box', 'text', 'table', 'guide'],
    variants: [{ key: 'plan', name: '결과', ...plan }],
    code: { label: 'doc.json', text: src(sample) },
  },
  {
    key: 'report', name: '월간 업무 보고', group: '새 문서',
    desc: '과제 정보표, 진척도 표, 주요 실적, 다음 달 계획 상자로 구성한 1쪽 보고. 표 중심 문서도 같은 블록으로 만듭니다.',
    tags: ['h1', 'table', 'text', 'box'],
    variants: [{ key: 'report', name: '결과', ...monthly }],
    code: { label: 'doc.json', text: src(report) },
  },
  {
    key: 'result', name: '실증 결과보고서 (그림)', group: '새 문서',
    desc: '구성도와 서비스 화면을 넣은 결과보고서. image 블록은 PNG·JPEG를 본문 폭에 맞춰 글자처럼 배치하고, 아래에 <그림 n> 번호를 붙입니다. 그림은 예시를 위해 그린 가상 도식·화면입니다.',
    tags: ['image', 'chapter', 'text', 'table', 'pagebreak'],
    variants: [{ key: 'result', name: '결과', ...figures }],
    code: { label: 'doc.json', text: src(result) },
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

fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({ items }));
for (const f of ['index.html', 'mega-hwp.svg', 'symbol.svg']) fs.copyFileSync(path.join(HERE, f), path.join(OUT, f));
console.log(`gallery → ${OUT} (${items.length}개 예시, ${new Set(items.flatMap((i) => i.variants.flatMap((v) => v.pages))).size}쪽)`);
