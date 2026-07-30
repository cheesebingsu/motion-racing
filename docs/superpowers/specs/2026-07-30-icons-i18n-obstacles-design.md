# 아이콘 · 영어 i18n · 신규 장애물 설계

- 작성일: 2026-07-30
- 대상: 모션 레이싱 (웹캠 3D 레이싱, 정적 GitHub Pages)

## Feature 1 — 이모지 → 미니멀 라인 아이콘
- `js/icons.js`: `icon(name)` → 인라인 SVG(stroke, `currentColor`, ~1.7px, round cap). 외부 dep 0.
- 17종: trophy, gear, user, pause, home, play, spark(신기록), heart, chevronLeft, chevronRight, x, bulb, expand, globe, phone.
- 정적 HTML은 `<span class="ico" data-ico="name"></span>` → 로드 시 `innerHTML=icon(name)`. HUD 목숨은 하트 SVG × lives.
- 색은 currentColor 상속(틸/빨강 등). 미니멀 테마 유지.

## Feature 2 — 영어 i18n (KO/EN)
- `js/i18n.js`: `STRINGS={ko,en}` (~60 키), `t(key,vars)`, `getLang/setLang`(persist `mr-lang`), `initLang()`(첫 방문 navigator.language, ko*→ko else en), `applyI18n(root)`.
- 정적 HTML: `data-i18n`(textContent), `data-i18n-aria`(aria-label), `data-i18n-ph`(placeholder).
- JS 문자열: HUD(거리/속도/최종/연습), 상태 메시지, 랭킹, 게임오버, 차량/맵/난이도/시점 이름 → `t()`.
- game3d.js/main.js/ranking.js/hand-tracking.js가 i18n.js import(무의존).
- 언어 선택 UI: 로비 연습모드 아래 `globe KO|EN` 토글 + 설정 화면. 전환 시 applyI18n + 동적 UI 재빌드(차량/맵 카드, HUD 라벨).

## Feature 3 — 신규 장애물 + 활로 보장
등장: 거리 ≥ 3000m 이후 쿨다운(겹침 방지)으로 특수 이벤트 1개씩.

**불변식**: pathLane(활로)은 어떤 장애물도 해당 z에서 점유 못 함.

- **역주행 차/자전거**: 먼 곳 비-pathLane 레인 등장 → 플레이어 쪽으로 접근(closing speed). 활성 동안 pathLane을 그 레인으로 못 옮기게 핀 + 정적 density 1 감소. 풀링. 충돌은 일반 장애물과 동일.
- **횡단 보행자/자전거**: 출몰 전 ~0.7s 반짝 예고(z+진입쪽). 가로 이동. 그 z-밴드엔 정적 행 억제 + pathLane 레인은 통과 순간 항상 빈틈(타이밍/핀; 불가 시 부분횡단 폴백). 풀링.
- 에셋: 역주행 차 = 기존 GLB 180° 회전. 보행자/자전거 = 간단 프로시저럴(몸통+머리). 예고 = 가벼운 발광 스프라이트. 크레딧 0.

**Acceptance test (헤드리스 시뮬)**: 수천 행 + 수백 특수 이벤트 동안, 매 스텝 pathLane 셀이 어떤 장애물(정적/역주행/횡단)에도 안 막힘을 자동 단언. 밀도 검증과 동일 엄격도.

## 구현 순서 (단계별 검증·배포)
1. 아이콘 (icons.js + 교체)
2. i18n (i18n.js + data-i18n + t() + 언어토글)
3. 신규 장애물 + 활로(코리도 불변 + 클리어런스 창) + 시뮬 검증

## 비목표
- 레거시 js/game.js(미로드) 변경. 한/영 외 언어. 자전거 정밀 모델링.
