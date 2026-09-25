---
name: mega-hwp
description: 한글(HWP/HWPX) 문서를 읽고, 만들고, 양식을 채운다. 사용자가 .hwp/.hwpx 파일을 주거나 사업계획서·결과보고서·중간보고서·월간보고·연구개발계획서·공문·제안서를 한글 파일로 만들어 달라고 할 때, 또는 정부과제 양식(작성요령이 있는 빈 양식)을 채워 달라고 할 때 사용. text(HWP→마크다운) → doc.json/fill.json 작성 → build/fill로 편집 가능한 .hwp 생성 → 페이지 PNG로 시각 검수. 한국어 우선.
license: MIT
metadata:
  version: "0.1.0"
---

# mega-hwp

한국 정부과제·공공기관 문서의 **보고서체**(□ ○ - · ※ 개조식, 표, 작성요령 상자)로 한글 파일을 만든다. 엔진은 [rhwp](https://github.com/edwardkim/rhwp)(Rust+WASM)이고, 결과는 한컴오피스에서 바로 열고 고칠 수 있는 `.hwp`/`.hwpx`다.

이 파일이 있는 디렉터리를 `$SKILL`이라 한다. Node 18+가 필요하고, 첫 실행 때 `@rhwp/core`를 자동 설치한다. 렌더링에는 `rsvg-convert`(`brew install librsvg`)를 쓴다.

```bash
node $SKILL/scripts/hwp.mjs text   in.hwp                          # 읽기: 본문+표 → 마크다운 (표 주소 포함)
node $SKILL/scripts/hwp.mjs build  doc.json -o out.hwp             # 새 문서 (.hwpx로 쓰면 HWPX)
node $SKILL/scripts/hwp.mjs fill   form.hwp fill.json -o out.hwp   # 양식 채우기
node $SKILL/scripts/hwp.mjs render out.hwp [--pages 1-3]           # out/page-NN.png (rhwp 렌더)
node $SKILL/scripts/hwp.mjs hancom out.hwp                         # out-hancom/hancom-NN.png (macOS, 실제 한컴 화면)
```

## 워크플로

### 1. 파악
- 첨부된 `.hwp`/`.hwpx`는 먼저 `text`로 읽는다. 표는 `<!-- table sec= para= ctrl= -->` 주석과 함께 마크다운 표로 나온다.
- **양식인가, 참고 자료인가?** 빈칸·`작성요령`·`ㅇ - *` 자리표시가 있으면 양식이다 → 3-B. 새로 쓰는 문서면 → 3-A.
- 모르면 묻는다(최대 3개): 제출처와 목적, 분량, 소스 자료. **숫자는 소스에서만** 가져오고 없으면 `[확인 필요]`로 둔다.

### 2. 목차 확인
쓰기 전에 장·절 제목과 절마다 핵심 문장 한 줄을 보여주고 확인을 받는다. 양식이면 양식의 목차를 그대로 따른다.

### 3-A. 새 문서 → [`references/schema.md`](references/schema.md)
`doc.json`의 `blocks`에 `title`·`chapter`·`h2`·`text`·`table`·`box`·`guide`·`image`·`pagebreak`를 순서대로 쓴다. 예시: [`examples/sample.json`](examples/sample.json).
- 본문은 `text` 블록에 **기호로 시작하는 줄**로 쓴다. 기호가 수준·서체·내어쓰기를 정한다: `□`(주제) → `○`(항목) → `-`(세부) → `·`(보충), `※`(주석). → [`references/style-guide.md`](references/style-guide.md)
- 비교·일정·예산·성과지표는 `table`, 장 앞 결론은 `box`(핵심 요약)로 보여준다.

### 3-B. 양식 채우기 → [`references/schema.md`](references/schema.md#fill)
`fill.json`에 다음을 쓴다. 양식의 서체·크기는 칸마다 유지된다.
- `cells`: 라벨 옆 칸(`{"label":"과업명","text":…}`) 또는 `text` 출력의 주소(`{"para":17,"ctrl":0,"row":1,"col":0,…}`)
- `insert`: 제목 문단 뒤에 블록 삽입(`{"after":"1. 사업목표","blocks":[…]}`). 바로 뒤의 `ㅇ - *` 자리표시 줄은 지워진다
- `replace`: 문구 치환, `fields`: 누름틀 값
- `removeTables`: 제출 전 `작성요령` 상자 삭제 (양식이 "작성요령은 삭제 후 제출"이라고 할 때만)

### 4. 빌드
**WARN이 0개가 될 때까지** 고친다. 앵커·라벨을 못 찾으면 `text` 출력의 글자와 정확히 맞춘다(공백은 무시된다).

### 5. 시각 검수 (생략 금지)
PNG를 **모두 직접 열어 보고** 표 넘침, 빈 쪽, 들여쓰기·내어쓰기, 병합, 칸 배경, 자리표시가 남았는지 확인한다. 고친 뒤 다시 빌드·검수한다.
- **macOS에 한컴오피스가 있으면 `hancom`으로 검수한다.** 실제 한컴 조판 결과라 가장 정확하다. 파일을 임시 이름으로 복사해 열고, 한컴 창만 캡처한 뒤 그 창만 닫는다. 권한 오류가 나면 사용자에게 시스템 설정 → 개인정보 보호 및 보안의 **화면 기록**과 **손쉬운 사용**에 명령을 실행하는 앱(Claude Code: `~/Library/Application Support/Claude/claude-code/<버전>/claude.app`)을 추가하고 앱을 다시 실행해 달라고 안내한다.
- 그 밖에는 `render`(rhwp 렌더)를 쓴다. 글자 폭이 근사치라 줄바꿈 위치가 한컴과 조금 다를 수 있으니, 마지막에 사용자에게 한컴오피스로 열어 확인하라고 알린다.

## 원칙
- **개조식 명사형 종결**: "~ 확보", "~ 구축", "~ 필요". 한 항목은 1~2줄.
- **숫자에는 단위·기준 연도·출처**: 표 아래 `note`에 `※ 출처: …`.
- 양식을 채울 때 양식의 **목차·번호·표 구조를 바꾸지 않는다.** 칸이 모자라면 사용자에게 알린다.
- 이미지는 지어내지 않는다. 필요하면 `[그림: 무엇]` 자리를 두고 알려준다.
