<h1><img src="assets/mega-hwp.svg" alt="mega-hwp" width="220" /></h1>

[문서 갤러리](https://codeblack-inc.github.io/mega-hwp/) · [**처음 쓰는 사람을 위한 가이드**](docs/GUIDE.md) · [mega 제품군](https://codeblack-inc.github.io/mega-bi/) · [브랜드 가이드와 로고](https://github.com/Codeblack-Inc/mega-bi)

한글(HWP/HWPX) 문서를 AI가 읽고, 만들고, 정부과제 양식을 채우는 Claude Code / Codex 플러그인.

mega-hwp는 [mega 오픈소스 제품군](https://codeblack-inc.github.io/mega-bi/)의 한글 문서 도구다. HWP 파싱·저장·렌더링은 [rhwp](https://github.com/edwardkim/rhwp)(`@rhwp/core`, Rust+WASM, MIT)가 맡는다.

- **읽기**: `.hwp`/`.hwpx` → 마크다운. 표는 병합을 풀어 마크다운 표로, 칸마다 주소를 달아 양식 채우기에 바로 쓴다
- **새 문서**: `doc.json` → `.hwp`/`.hwpx`. 표지, 점선 목차(쪽번호 자동), 쪽번호 "- 1 -", 장 제목 띠, □○-·※ 기호별 서체·크기·내어쓰기, 병합 표·표 번호·출처, 핵심 요약 상자, 작성요령 상자, 그림
- **양식 채우기**: 라벨 옆 칸 채우기(칸의 원래 서체 유지), 제목 뒤 본문 삽입(`ㅇ - *` 자리표시 줄 자동 삭제), 문구 치환, 누름틀, 작성요령 상자 일괄 삭제
- **시각 검수**: 페이지를 PNG로 렌더링해 AI가 직접 보고 고친다. macOS에 한컴오피스가 있으면 실제 한컴 화면을 쪽마다 캡처해 검수한다(`hancom`)
- **보고서체 기준**: 실제 정부과제 문서 10종(약 900쪽)의 용지·글자·표·문장·밀도를 직접 잰 값 → [`style-guide.md`](skills/mega-hwp/references/style-guide.md), 문서 종류별 표준 목차·절별 표·문장 규칙 → [`plan-guide.md`](skills/mega-hwp/references/plan-guide.md)(계획서) · [`result-guide.md`](skills/mega-hwp/references/result-guide.md)(결과·중간보고서)
- **문장 점검**: `lint`가 □·○ 길이, - 대 ○ 비율, 숫자·화살표 남용, 표 대 본문 비율을 실제 문서 기준으로 잰다

## 설치

> 코딩이 처음이면 [docs/GUIDE.md](docs/GUIDE.md)를 보세요 — Claude 앱·ChatGPT(Codex)에서 쓰는 법, 그림 플러그인 [mega-diagram](https://codeblack-inc.github.io/mega-diagram/)과 같이 쓰는 법.

**Claude Code**
```text
/plugin marketplace add Codeblack-Inc/mega-hwp
/plugin install mega-hwp@mega-hwp
```

**Codex**
```bash
codex plugin marketplace add Codeblack-Inc/mega-hwp
codex plugin add mega-hwp@mega-hwp
```

**로컬 개발(심볼릭 링크)**
```bash
ln -s "$PWD/skills/mega-hwp" ~/.claude/skills/mega-hwp
ln -s "$PWD/skills/mega-hwp" ~/.codex/skills/mega-hwp
```

필요 도구: Node 18+ (`@rhwp/core`·`fflate`는 첫 실행 때 자동 설치), 시각 검수용 `rsvg-convert` (`brew install librsvg`). 한컴 화면 검수(`hancom`)는 macOS + 한컴오피스 한글 + Xcode 명령행 도구(`swift`)가 필요하고, 실행하는 앱에 **화면 기록**·**손쉬운 사용** 권한을 줘야 한다.

## 사용
> 이 양식(.hwp)에 맞춰 결과보고서 채워줘

> 이 자료로 사업계획서 한글 파일 만들어줘

직접 실행:
```bash
node skills/mega-hwp/scripts/hwp.mjs text  양식.hwp
node skills/mega-hwp/scripts/hwp.mjs build skills/mega-hwp/examples/sample.json -o sample.hwp --render
node skills/mega-hwp/scripts/hwp.mjs fill  양식.hwp fill.json -o 제출본.hwp
node skills/mega-hwp/scripts/hwp.mjs hancom sample.hwp   # macOS + 한컴오피스
```

## 구조
```
.claude-plugin/            Claude Code 플러그인 + 마켓플레이스 매니페스트
.codex-plugin/             Codex 플러그인 매니페스트
.agents/plugins/           Codex 마켓플레이스
skills/mega-hwp/
  SKILL.md                 워크플로 (파악 → 목차 → doc.json/fill.json → 빌드 → 검수)
  references/              schema.md(블록·양식 채우기 스펙) · style-guide.md(실측 서식·문장) · plan-guide.md(계획서) · result-guide.md(결과보고서)
  scripts/hwp.mjs          text · build · fill · lint · render · hancom
  scripts/hancom.swift     한컴오피스로 열어 쪽마다 캡처 (macOS)
  examples/sample.json     예시 문서 (가상 과제)
tests/test.mjs             왕복 테스트 (node tests/test.mjs)
gallery/                   갤러리 사이트 (node gallery/build.mjs → site/, main에 push하면 Pages 배포)
```

## 한계
- `render` PNG의 글자 폭은 근사치다. 줄바꿈 위치는 한컴오피스와 조금 다를 수 있다 — 정확한 확인은 `hancom`.
- 표 안의 표(중첩 표)는 읽기에서 바깥 칸 글자로만 나오고, 채우기 주소로 지정할 수 없다.
- 글상자·도형 안의 글자는 읽지 않는다.
- mega-hwp가 저장한 파일을 `render`로 다시 그리면 그림이 빠진다(rhwp 한계, 한컴에서는 정상). 검수는 `build`/`fill`의 `--render`로 한다.

## License
MIT · HWP 엔진: [rhwp](https://github.com/edwardkim/rhwp) (MIT)
