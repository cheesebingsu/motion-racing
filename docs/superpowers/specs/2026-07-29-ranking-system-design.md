# 랭킹 시스템 설계 (Ranking System Design)

- 작성일: 2026-07-29
- 대상: 모션 레이싱 (motion-racing) — 웹캠 상체 모션 3D 레이싱 웹게임
- 배포: GitHub Pages (정적 사이트, 서버 없음)

## 1. 목표 (Goals)

플레이어가 거리(m) 기록으로 경쟁할 수 있는 랭킹 시스템을 추가한다.

- 서비스 첫 실행 시 **닉네임**을 입력받는다.
- **랭킹 페이지**에서 두 가지를 보여준다:
  - **내 랭킹**: 내가 플레이한 기록 이력 + 전체에서 내 순위
  - **전체 랭킹**: 이 게임을 플레이한 모든 사람의 랭킹 (각자 **최고 기록**만 반영)
- 랭킹은 **난이도별**(쉬움/중간/어려움)로 각각 만든다.

## 2. 핵심 결정 (인터뷰로 확정)

| 항목 | 결정 |
|------|------|
| 백엔드 | **Supabase** (무료 Postgres + 자동 REST/JS SDK). 전체 랭킹은 공유 저장소가 필수 |
| 신원 | **기기 기반 playerId(uuid) + 표시용 닉네임(중복 허용, 변경 가능)** — 캐주얼 게임 표준 |
| 점수 | **거리(m)**, 높을수록 상위 |
| 랭킹 축 | **난이도만** (차량·맵·시점 무관). 리더보드 3개(쉬움/중간/어려움) |
| 집계 제외 | **연습 모드**(장애물 없음)는 집계 안 함 |
| 전체 랭킹 반영 | 사람×난이도당 **최고 거리 한 줄** |
| 보안 | 로그인 없음 → **점수 조작 원천 차단 불가**(캐주얼이라 수용). 거리 상한 체크 정도의 가벼운 방어만 |

## 3. 아키텍처 (2계층)

### 3.1 로컬 (localStorage) — 내 것만
- `mr-profile`: `{ playerId: uuid, nickname: string }`
- `mr-history`: 배열 `{ difficulty: 'easy'|'medium'|'hard', distance: int, ts: number }` — 최근 50개 유지
  - 난이도별 내 최고 = history에서 파생

### 3.2 원격 (Supabase) — 전체 공유
테이블 `scores`:

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK (default gen_random_uuid()) | |
| player_id | uuid NOT NULL | 기기 신원 |
| nickname | text NOT NULL | 표시명 (변경 시 갱신) |
| difficulty | text NOT NULL | `easy`\|`medium`\|`hard` (CHECK) |
| distance | int NOT NULL | 최고 거리(m) |
| created_at | timestamptz DEFAULT now() | |

- **UNIQUE(player_id, difficulty)** — 사람×난이도당 최고기록 1줄. 신기록 시 upsert.
- CHECK 제약: `difficulty in ('easy','medium','hard')`, `distance >= 0 and distance <= 100000` (상한 방어)
- RLS: 활성화. 정책 = 익명(anon) **SELECT 전체 허용**, **INSERT/UPDATE 허용**(로그인 없음).
  - 조작 방지는 불가하나 캐주얼 수용. 상한 CHECK로 극단값만 차단.

### 3.3 SQL (사용자가 Supabase 대시보드에 붙여넣을 것)
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

## 4. 사용자 흐름 (User Flow)

### 4.1 첫 실행
1. 프로필(`mr-profile`)이 없으면 **닉네임 입력 모달** 표시 (1~12자, trim).
2. `playerId = crypto.randomUUID()` 생성, 닉네임과 함께 저장.
3. 이후 홈에서 프로필 영역으로 닉네임 **변경 가능** (변경 시 다음 제출부터 원격 nickname 갱신).

### 4.2 게임오버 (연습 모드 제외)
1. 로컬 `mr-history`에 `{ difficulty, distance, ts }` 추가.
2. 이번 거리가 **해당 난이도 내 최고를 갱신**하면 Supabase에 upsert(onConflict player_id+difficulty) → 게임오버 화면에 **"🎉 신기록!"** 배지.
3. 네트워크 실패/오프라인이어도 로컬 저장은 성립. 원격 실패는 조용히 무시(다음 신기록 때 재시도).

### 4.3 랭킹 보기 진입점
- 홈 화면의 **🏆 랭킹** 버튼
- 게임오버 화면의 **🏆 랭킹/내 순위** 버튼 (방금 친 기록 → 순위 확인 훅)

## 5. 랭킹 페이지 UI

- 상단 **난이도 탭**: 쉬움 / 중간 / 어려움 (진입 시 방금 플레이한 난이도가 기본 선택; 없으면 중간)
- **전체 랭킹** 섹션:
  - 해당 난이도 상위 100명: `순위 · 닉네임 · 거리(m)`
  - **내 줄 하이라이트**. 내가 100위 밖이면 목록 아래에 "내 순위: N위 · 닉네임 · 거리" 별도 행.
- **내 기록** 섹션:
  - 해당 난이도의 내 플레이 이력(최신순), 내 최고 기록 강조.
- 데이터 로딩/에러/오프라인 상태 메시지 처리.

### 5.1 쿼리 (supabase-js v2)
- 전체 상위: `select('nickname,distance').eq('difficulty', d).order('distance', { ascending:false }).limit(100)`
- 내 순위: `select('*', { count:'exact', head:true }).eq('difficulty', d).gt('distance', myBest)` → `count + 1`
- 내 최고 제출: `upsert({ player_id, nickname, difficulty, distance }, { onConflict: 'player_id,difficulty' })` — 단, 로컬 최고를 넘어설 때만 호출 (조건은 클라이언트에서 판단, 기기 신원이라 로컬=내 최고).

## 6. 구성/시크릿

- Supabase **Project URL** + **anon(public) key**는 클라이언트에 노출되어도 되는 값(RLS로 보호).
- 별도 파일 `js/config.js` 에 상수로 두고 로드. (키가 없으면 원격 기능은 비활성, 로컬만 동작 → 점진적 도입 가능)

## 7. 파일별 변경 (구현 시)

- `index.html`: 닉네임 모달, 랭킹 페이지 오버레이, 홈/게임오버의 🏆 버튼 마크업 추가.
- `js/config.js` (신규): Supabase URL/anon key.
- `js/ranking.js` (신규): 프로필/로컬 history 관리, Supabase 클라이언트, 제출·조회 함수, 랭킹 페이지 렌더.
- `js/main.js`: 첫 실행 닉네임 체크, 게임오버 훅에서 기록 제출, 버튼 배선, 선택 난이도 연동.
- `js/game3d.js`: `_endGame`에서 최종 거리·난이도·연습여부를 콜백/이벤트로 노출(이미 distance 보유).
- `style.css`: 모달·랭킹 페이지·탭·순위표 스타일 (기존 네온 테마 재사용).
- supabase-js는 CDN ESM import (import map에 추가) — 구현 시 context7로 최신 v2 사용법 확인.

## 8. 비목표 (Non-goals)

- 로그인/인증, 비밀번호, 이메일.
- 조작 방지(안티치트) 시스템 — 상한 CHECK 외.
- 차량/맵/시점별 세부 랭킹.
- 시즌/기간제 랭킹, 친구 초대, 클립 공유 (별도 기능, 이번 범위 아님).

## 9. 열린 항목 / 기본값

- 닉네임 검증: 길이 1~12, 공백 trim. 욕설 필터는 이번 범위 제외(기본값).
- 전체 랭킹 표시 수: 상위 100 (기본값).
- 로컬 history 보관: 난이도별 최근 50개 (기본값).
- 동점 처리: 거리 같으면 먼저 달성(created_at 빠른 쪽) 우선.
