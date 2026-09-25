# mega-hwp

Claude Code + Codex 플러그인. 공용 스킬은 `skills/mega-hwp/` 하나 — 두 호스트가 같은 파일을 쓴다.

- 엔진: `skills/mega-hwp/scripts/hwp.mjs` 한 파일 (text · build · fill · render). HWP 읽기/쓰기는 [`@rhwp/core`](https://github.com/edwardkim/rhwp) WASM, 첫 실행 때 `skills/mega-hwp/node_modules`에 자동 설치
- rhwp 편집 API는 JSON 문자열을 주고받는다. 서식 키는 `rhwp.d.ts`에 없고 rhwp 소스 `src/document_core/helpers.rs`(`parse_char_shape_mods`, `parse_para_shape_mods`)에 있다. 문단 여백 1pt = 200
- 주의: 표·그림만 든 문단은 길이가 0으로 잡힌다. 그 문단을 끝에서 가르면 표가 다음 문단으로 밀리므로, 표를 넣기 전에 빈 문단을 먼저 만든다 (`Writer.table`)
- 주의: `getControls()`의 `para`는 구역을 이어 붙인 전역 번호다 (`walk`)
- 한컴 호환 (한컴오피스로 직접 열어 확인한 것 — rhwp 렌더러로는 안 보인다):
  - 한컴은 파일에 저장된 줄 배치(lineseg)를 그대로 쓰고 다시 조판하지 않는다. rhwp가 만든 줄 배치엔 들여쓰기·내어쓰기가 빠져 있어 `save()`가 HWPX에서 `linesegarray`를 모두 지운 뒤 저장한다(.hwp는 그 HWPX를 다시 읽어 변환)
  - 칸 배경은 `patternType: -1`(무늬 없음). 0이면 한컴이 가로줄 무늬로 그린다
- 블록 추가: `Writer.block`의 switch → `references/schema.md` → `examples/sample.json`
- 테스트: `node tests/test.mjs`
- 한컴 검수: `node skills/mega-hwp/scripts/hwp.mjs hancom /tmp/s.hwp` → `/tmp/s-hancom/hancom-NN.png`. rhwp 렌더와 한컴 화면이 다르면 한컴이 맞다. 레이아웃·서식을 바꿨으면 반드시 한컴으로도 본다
- 시각 확인: `node skills/mega-hwp/scripts/hwp.mjs build skills/mega-hwp/examples/sample.json -o /tmp/s.hwp --render` → `/tmp/s/page-NN.png`. 저장된 파일을 `render`하면 그림만 있는 문단이 높이 0이 되어 그림이 빠진다(줄 배치를 지운 탓, 한컴은 정상) — 그래서 `--render`는 저장 전 메모리 문서로 그린다
- 갤러리: `node gallery/build.mjs` → `site/` (sample.json + `gallery/*.json` 예시, rsvg-convert 필요). 예시 그림은 `gallery/mocks/*.html`을 Chrome 헤드리스로 캡처해 `gallery/assets/`에 커밋(CI는 재생성하지 않음, 가상 화면만). main에 push하면 `.github/workflows/pages.yml`이 Noto CJK 폰트를 설치하고 빌드·배포. 예시를 바꾸면 `hwp.mjs hancom`으로 한컴 화면도 확인한다(갤러리 문구가 "한컴오피스에서 확인"이라고 말한다)
- 버전 올릴 때 `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, SKILL.md `metadata.version` 함께 수정
- 예시 콘텐츠는 가상의 과제만 쓴다 (실제 고객·과제 자료, 사용자가 준 양식 파일 커밋 금지)
