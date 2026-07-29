# 랭킹 시스템 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹캠 레이싱 게임에 난이도별 전체 랭킹(Supabase) + 내 기록(localStorage) 시스템을 추가한다.

**Architecture:** 2계층. 로컬(localStorage)에 프로필(playerId+닉네임)과 내 플레이 이력을 저장하고, 원격(Supabase `scores` 테이블)에 사람×난이도당 최고 거리 1줄을 upsert한다. 랭킹 페이지는 난이도 탭으로 전체 상위 100 + 내 순위 + 내 기록을 보여준다.

**Tech Stack:** Vanilla JS (ES modules, no build), Three.js(기존), Supabase JS v2(CDN ESM), localStorage, GitHub Pages.

## Global Constraints

- 빌드/번들러/테스트러너 없음 — 브라우저에서 바로 실행. 검증은 Playwright MCP + 콘솔.
- 스크립트는 ESM, `index.html`의 import map에 의존성 추가(three처럼).
- 점수 = 거리(m, 정수). 난이도 = `easy|medium|hard`. 연습모드(practice)는 **집계 제외**.
- 신원 = `playerId`(crypto.randomUUID, localStorage) + 표시 닉네임(중복 허용, 1~12자).
- 전체 랭킹 반영 = 사람×난이도당 **최고 거리 한 줄**(UNIQUE player_id+difficulty upsert).
- Supabase URL/anon key는 클라이언트 공개 가능(RLS 보호). 키 없으면 원격 비활성 + 로컬만 동작.
- UI 텍스트 한국어, 기존 네온 BEM 테마/`:root` 변수 재사용.
- localStorage 키: 프로필 `mr-profile`, 이력 `mr-history`.
- 매 태스크 후 커밋. 새 포트로 서버 띄워 캐시 회피(기존 관행).

---

## Task 0 (외부 선행): Supabase 프로비저닝 — 사용자

**담당:** 사용자 (Claude가 대신 계정 생성 불가). Task 5 실행 전까지 완료 필요. Task 1~4, 6은 이 키 없이 진행 가능.

- [ ] supabase.com 무료 프로젝트 1개 생성
- [ ] SQL 편집기에 아래 실행:

```sql
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null,
  nickname text not null,
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  distance int not null check (distance >= 0 and distance <= 100000),
  created_at timestamptz not null default now(),
  unique (player_id, difficulty)
);
create index if not exists scores_diff_dist_idx on public.scores (difficulty, distance desc);
alter table public.scores enable row level security;
create policy "public read"   on public.scores for select using (true);
create policy "public insert" on public.scores for insert with check (true);
create policy "public update" on public.scores for update using (true) with check (true);
```

- [ ] Project Settings → API 에서 **Project URL** + **anon public key** 복사 → Claude에게 전달

---

## Task 1: 설정 파일 + Supabase 클라이언트 부트스트랩

**Files:**
- Create: `js/config.js`
- Modify: `index.html` (import map에 `@supabase/supabase-js` 추가)

**Interfaces:**
- Produces: `js/config.js` exports `SUPABASE_URL: string`, `SUPABASE_ANON_KEY: string` (빈 문자열이면 원격 비활성).

- [ ] **Step 1:** `js/config.js` 생성 (키는 Task 5에서 사용자 값으로 교체; 초기엔 빈 문자열):

```js
// js/config.js — Supabase 접속 정보. 클라이언트 공개 가능(RLS 보호).
// 값이 비어있으면 원격 랭킹은 비활성(로컬만 동작).
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
```

- [ ] **Step 2:** `index.html` import map에 supabase 추가 (three 항목 옆):

```json
"@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
```

- [ ] **Step 3 (검증):** 새 포트로 서버 → 콘솔에서 `await import('/js/config.js')` 가 객체 반환, `import('@supabase/supabase-js')` 가 `createClient` 노출 확인. (context7로 supabase-js v2 `createClient` 시그니처 확인)
- [ ] **Step 4 (커밋):** `git add index.html js/config.js && git commit -m "feat(rank): supabase 설정 파일 + import map"`

---

## Task 2: 프로필 & 로컬 이력 모듈 (순수 localStorage)

**Files:**
- Create: `js/ranking.js`

**Interfaces:**
- Produces:
  - `getProfile(): {playerId, nickname} | null`
  - `ensureProfile(nickname): {playerId, nickname}` — 없으면 playerId 생성·저장, 있으면 닉네임 갱신
  - `setNickname(nickname): void`
  - `addRun(difficulty, distance): {isBest: boolean}` — 이력 추가(최근 50 유지), 해당 난이도 신기록이면 isBest=true
  - `getHistory(difficulty): Array<{difficulty,distance,ts}>` — 최신순
  - `getLocalBest(difficulty): number` — 없으면 0
  - `DIFFS = ['easy','medium','hard']`

- [ ] **Step 1:** `js/ranking.js`에 로컬 계층 구현:

```js
// js/ranking.js — 랭킹: 로컬 프로필/이력 + (Task5) Supabase 원격.
const PROFILE_KEY = 'mr-profile';
const HISTORY_KEY = 'mr-history';
export const DIFFS = ['easy', 'medium', 'hard'];
const HISTORY_CAP = 50;

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

export function getProfile() { return read(PROFILE_KEY, null); }
export function ensureProfile(nickname) {
  const cur = getProfile();
  const playerId = cur?.playerId || crypto.randomUUID();
  const prof = { playerId, nickname: (nickname || cur?.nickname || '플레이어').trim().slice(0, 12) };
  write(PROFILE_KEY, prof); return prof;
}
export function setNickname(nickname) {
  const cur = getProfile(); if (!cur) return;
  write(PROFILE_KEY, { ...cur, nickname: nickname.trim().slice(0, 12) });
}
export function getHistory(difficulty) {
  return read(HISTORY_KEY, []).filter((r) => r.difficulty === difficulty)
    .sort((a, b) => b.ts - a.ts);
}
export function getLocalBest(difficulty) {
  return getHistory(difficulty).reduce((m, r) => Math.max(m, r.distance), 0);
}
export function addRun(difficulty, distance) {
  const prevBest = getLocalBest(difficulty);
  const all = read(HISTORY_KEY, []);
  all.push({ difficulty, distance: Math.floor(distance), ts: Date.now() });
  // 최근 HISTORY_CAP개만 유지(전체 기준)
  write(HISTORY_KEY, all.slice(-HISTORY_CAP));
  return { isBest: Math.floor(distance) > prevBest };
}
```

- [ ] **Step 2 (검증):** 콘솔에서 `import('/js/ranking.js')` 후: `ensureProfile('테스트')` → playerId uuid 확인; `addRun('medium',100)` → `{isBest:true}`; `addRun('medium',50)` → `{isBest:false}`; `getLocalBest('medium')===100`; `getHistory('medium').length===2`.
- [ ] **Step 3 (커밋):** `git add js/ranking.js && git commit -m "feat(rank): 로컬 프로필/이력 모듈"`

---

## Task 3: 첫 실행 닉네임 모달

**Files:**
- Modify: `index.html` (모달 마크업), `style.css` (모달 스타일), `js/main.js` (첫 실행 체크·배선)

**Interfaces:**
- Consumes: `getProfile`, `ensureProfile` (Task 2)
- Produces: 페이지 로드시 프로필 없으면 모달 표시, 확인 시 `ensureProfile(nickname)` 저장 후 닫기.

- [ ] **Step 1:** `index.html` `.app` 안에 모달 추가:

```html
<div id="nick-modal" class="modal" hidden>
  <div class="modal__panel">
    <h2 class="modal__title">닉네임을 입력하세요</h2>
    <input id="nick-input" class="modal__input" maxlength="12" placeholder="1~12자" />
    <button id="nick-ok" class="btn btn--primary">시작</button>
    <p class="modal__hint">랭킹에 표시될 이름이에요 (나중에 변경 가능)</p>
  </div>
</div>
```

- [ ] **Step 2:** `style.css`에 모달 스타일(기존 `--panel`/`--neon-*` 재사용): `.modal`(fixed inset0, flex center, 반투명 백드롭, z-index 60), `.modal__panel`(패널), `.modal__input`(네온 보더), `.modal__title/hint`. (기존 `.screen__panel` 스타일 참고해 일관.)
- [ ] **Step 3:** `js/main.js` 상단에 import + 첫 실행 로직:

```js
import { getProfile, ensureProfile } from './ranking.js';
// ...
const nickModal = document.getElementById('nick-modal');
const nickInput = document.getElementById('nick-input');
const nickOk = document.getElementById('nick-ok');
function openNickModal() {
  const p = getProfile();
  if (nickInput) nickInput.value = p ? p.nickname : '';
  if (nickModal) nickModal.hidden = false;
  if (nickInput) nickInput.focus();
}
function saveNick() {
  const v = (nickInput.value || '').trim();
  if (v.length < 1) { nickInput.focus(); return; }
  ensureProfile(v);
  if (nickModal) nickModal.hidden = true;
}
if (nickOk) nickOk.addEventListener('click', saveNick);
if (nickInput) nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNick(); });
if (!getProfile()) openNickModal();   // 첫 실행만
```

- [ ] **Step 4 (검증):** localStorage 비운 새 세션 → 모달 표시, "철수" 입력·시작 → 모달 닫힘, `getProfile().nickname==='철수'`. 새로고침 시 모달 안 뜸.
- [ ] **Step 5 (커밋):** `git add index.html style.css js/main.js && git commit -m "feat(rank): 첫 실행 닉네임 모달"`

---

## Task 4: 게임오버 훅 — 최종 기록 노출 & 로컬 저장

**Files:**
- Modify: `js/game3d.js` (`_endGame`에서 결과 콜백), `js/main.js` (콜백에서 addRun)

**Interfaces:**
- Consumes: `addRun` (Task 2)
- Produces: 게임 인스턴스에 `onGameOver` 콜백. 인자 `{ distance:int, difficulty:string, practice:boolean }`.

- [ ] **Step 1:** `js/game3d.js` `_endGame`에 콜백 호출 추가(기존 로직 유지, 끝에):

```js
// _endGame() 내부, finalScore 세팅 직후:
if (typeof this.onGameOver === 'function') {
  this.onGameOver({ distance: Math.floor(this.distance), difficulty: this.difficultyId, practice: !!this.practice });
}
```
(주의: `this.difficultyId`가 없으면 `start(opts)`에서 `this.difficultyId = opts.difficulty || 'medium'` 저장 추가.)

- [ ] **Step 2:** `js/main.js`에서 게임 생성 직후 콜백 연결 + import `addRun`:

```js
import { addRun } from './ranking.js';
// game 생성부(beginGame/restartGame에서 new RacingGame 직후) 공통 위치에:
function attachGameOver() {
  if (!game) return;
  game.onGameOver = ({ distance, difficulty, practice }) => {
    if (practice) return;                 // 연습모드 집계 제외
    const { isBest } = addRun(difficulty, distance);
    lastResult = { distance, difficulty, isBest };  // Task6에서 게임오버 배지/랭킹에 사용
    // 원격 제출은 Task 5에서 여기 추가
  };
}
```
(`let lastResult = null;` 선언 추가, `attachGameOver()`를 game 생성 지점에서 호출.)

- [ ] **Step 3 (검증):** medium으로 플레이→게임오버 시 콘솔 `getHistory('medium')`에 항목 추가, 첫 기록이면 `lastResult.isBest===true`. practice 모드에선 이력 추가 안 됨.
- [ ] **Step 4 (커밋):** `git add js/game3d.js js/main.js && git commit -m "feat(rank): 게임오버 결과 콜백 + 로컬 기록 저장"`

---

## Task 5: Supabase 원격 (제출·조회) — 키 필요(Task 0)

**Files:**
- Modify: `js/config.js` (사용자 키 반영), `js/ranking.js` (원격 함수), `js/main.js` (게임오버 시 제출)

**Interfaces:**
- Produces:
  - `remoteEnabled(): boolean`
  - `submitBest(difficulty, distance): Promise<void>` — 로컬 최고 갱신 시에만 호출; upsert(onConflict player_id,difficulty)
  - `fetchTop(difficulty, limit=100): Promise<Array<{nickname,distance}>>`
  - `fetchMyRank(difficulty, myBest): Promise<number|null>` — 나보다 큰 distance 수 +1

- [ ] **Step 1:** 사용자 값으로 `js/config.js` 채우기 (URL/anon key).
- [ ] **Step 2:** `js/ranking.js`에 원격 계층 (context7로 supabase-js v2 `createClient/from/upsert/select/order/count` 최신 시그니처 확인 후):

```js
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
const supa = (SUPABASE_URL && SUPABASE_ANON_KEY) ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
export function remoteEnabled() { return !!supa; }

export async function submitBest(difficulty, distance) {
  if (!supa) return;
  const p = getProfile(); if (!p) return;
  try {
    await supa.from('scores').upsert(
      { player_id: p.playerId, nickname: p.nickname, difficulty, distance: Math.floor(distance) },
      { onConflict: 'player_id,difficulty' }
    );
  } catch (e) { /* 오프라인/실패 무시 */ }
}
export async function fetchTop(difficulty, limit = 100) {
  if (!supa) return [];
  const { data } = await supa.from('scores').select('nickname,distance')
    .eq('difficulty', difficulty).order('distance', { ascending: false }).limit(limit);
  return data || [];
}
export async function fetchMyRank(difficulty, myBest) {
  if (!supa || myBest <= 0) return null;
  const { count } = await supa.from('scores').select('*', { count: 'exact', head: true })
    .eq('difficulty', difficulty).gt('distance', myBest);
  return (count ?? 0) + 1;
}
```

- [ ] **Step 3:** `js/main.js` 게임오버 콜백에 원격 제출 추가:

```js
import { addRun, submitBest, getLocalBest } from './ranking.js';
// onGameOver 내부, addRun 후:
if (isBest) submitBest(difficulty, distance);   // 신기록만 원격 upsert
```

- [ ] **Step 4 (검증):** 실제 Supabase 연결. medium 신기록 → 대시보드 `scores`에 1줄; 재신기록 → 같은 줄 distance 갱신(중복 X). `fetchTop('medium')`/`fetchMyRank('medium', best)` 콘솔 확인.
- [ ] **Step 5 (커밋):** `git add js/config.js js/ranking.js js/main.js && git commit -m "feat(rank): Supabase 제출/조회 연동"`

---

## Task 6: 랭킹 페이지 UI (난이도 탭 · 전체 · 내 기록)

**Files:**
- Modify: `index.html`(랭킹 오버레이 + 홈/게임오버 버튼), `style.css`(랭킹/탭/순위표), `js/main.js`(렌더·배선)

**Interfaces:**
- Consumes: `DIFFS, getProfile, getHistory, getLocalBest, fetchTop, fetchMyRank, remoteEnabled`

- [ ] **Step 1:** `index.html`에 랭킹 오버레이:

```html
<div id="rank-screen" class="screen screen--rank" hidden>
  <div class="screen__panel rank">
    <h2 class="screen__title">🏆 랭킹</h2>
    <div class="rank__tabs" id="rank-tabs">
      <button class="rank__tab is-selected" data-diff="easy">쉬움</button>
      <button class="rank__tab" data-diff="medium">중간</button>
      <button class="rank__tab" data-diff="hard">어려움</button>
    </div>
    <div class="rank__section"><h3>전체 랭킹</h3><ol id="rank-global" class="rank__list"></ol></div>
    <div class="rank__myrank" id="rank-myrank"></div>
    <div class="rank__section"><h3>내 기록</h3><ol id="rank-mine" class="rank__list"></ol></div>
    <button id="rank-close" class="btn btn--ghost">닫기</button>
  </div>
</div>
```
그리고 홈 `#screen__actions`와 게임오버 화면에 `<button id="rank-open" class="btn btn--ghost">🏆 랭킹</button>` (게임오버용은 별 id `rank-open-over`).

- [ ] **Step 2:** `style.css`: `.screen--rank`(오버레이), `.rank__tabs/.rank__tab`(난이도 pill, `.difficulty__btn` 재사용 가능), `.rank__list li`(순위·닉네임·거리 3열 flex), `.rank__list li.is-me`(하이라이트), `.rank__myrank`, 스크롤 가능한 리스트(max-height + overflow).
- [ ] **Step 3:** `js/main.js` 렌더 함수:

```js
import { DIFFS, getProfile, getHistory, getLocalBest, fetchTop, fetchMyRank, remoteEnabled } from './ranking.js';
let rankDiff = 'medium';
const rankScreen = document.getElementById('rank-screen');
async function renderRank(diff) {
  rankDiff = diff;
  for (const t of document.querySelectorAll('.rank__tab')) t.classList.toggle('is-selected', t.dataset.diff === diff);
  const me = getProfile();
  // 전체
  const globalEl = document.getElementById('rank-global');
  const myrankEl = document.getElementById('rank-myrank');
  if (remoteEnabled()) {
    globalEl.innerHTML = '<li class="rank__loading">불러오는 중...</li>';
    const rows = await fetchTop(diff, 100);
    globalEl.innerHTML = rows.map((r, i) =>
      `<li class="${me && r.nickname===me.nickname ? 'is-me' : ''}"><span>${i+1}</span><b>${escapeHtml(r.nickname)}</b><em>${r.distance} m</em></li>`
    ).join('') || '<li class="rank__empty">아직 기록이 없어요</li>';
    const myBest = getLocalBest(diff);
    const myRank = await fetchMyRank(diff, myBest);
    myrankEl.textContent = myRank ? `내 순위: ${myRank}위 · ${myBest} m` : '';
  } else {
    globalEl.innerHTML = '<li class="rank__empty">전체 랭킹은 서버 연결 후 표시돼요</li>';
    myrankEl.textContent = '';
  }
  // 내 기록
  document.getElementById('rank-mine').innerHTML =
    getHistory(diff).map((r) => `<li><span>·</span><b>${new Date(r.ts).toLocaleDateString()}</b><em>${r.distance} m</em></li>`).join('')
    || '<li class="rank__empty">이 난이도 기록이 없어요</li>';
}
function openRank(diff) { rankScreen.hidden = false; renderRank(diff || rankDiff); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
```
배선: `#rank-tabs` 클릭→`renderRank(diff)`, `#rank-open`/`#rank-open-over` 클릭→`openRank(selectedDifficulty)`, `#rank-close`→`rankScreen.hidden=true`.

- [ ] **Step 4 (검증):** 홈 🏆 → 랭킹 페이지, 탭 전환, 내 기록 표시. 원격 연결 시 전체 랭킹·내 순위 표시, 내 줄 하이라이트. 게임오버에서 🏆 → 방금 난이도 기본 선택.
- [ ] **Step 5 (커밋):** `git add index.html style.css js/main.js && git commit -m "feat(rank): 랭킹 페이지(난이도 탭·전체·내 기록)"`

---

## Task 7: 통합 마무리 (게임오버 배지 · 기본 난이도 · 배포)

**Files:**
- Modify: `index.html`(게임오버 신기록 배지 자리), `js/main.js`(lastResult로 배지, openRank 기본 난이도)

- [ ] **Step 1:** 게임오버 화면에 `<div id="rank-newbest" hidden>🎉 신기록!</div>` 추가, `style.css`에 배지 스타일.
- [ ] **Step 2:** `js/main.js` 게임오버 표시 시: `lastResult?.isBest`면 배지 표시, 아니면 숨김. 게임오버 🏆 버튼은 `openRank(lastResult?.difficulty || selectedDifficulty)`.
- [ ] **Step 3 (검증):** 신기록 시 배지 노출, 아닐 때 숨김. 전체 플로우(닉네임→플레이→게임오버 배지→🏆 랭킹→탭) Playwright로 확인.
- [ ] **Step 4 (배포):** `git add -A && git commit -m "feat(rank): 신기록 배지 + 통합 마무리" && git push origin main`

---

## Self-Review (스펙 대비)

- 닉네임 첫 실행 입력 → Task 3 ✅
- 내 기록(이력)+내 순위 → Task 2(이력), Task 5(순위), Task 6(표시) ✅
- 전체 랭킹(모든 사람, 최고기록만) → Task 5 upsert + fetchTop ✅
- 난이도별 랭킹 → Task 6 탭 + 쿼리 eq(difficulty) ✅
- 연습모드 제외 → Task 4 practice 가드 ✅
- 기기 playerId+닉네임 → Task 2 ✅
- Supabase 스키마/RLS → Task 0 ✅
- 오프라인/키없음 처리 → Task 5 try/catch, remoteEnabled 가드 ✅
- 타입/이름 일관: `addRun/getLocalBest/getHistory/submitBest/fetchTop/fetchMyRank/remoteEnabled/DIFFS/onGameOver` 전 태스크 동일 사용 ✅
