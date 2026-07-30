// js/i18n.js — tiny i18n. STRINGS[lang][key]; t(key, vars) interpolates {n} etc.
// Lang persisted in localStorage 'mr-lang'; first visit auto-detects the browser.
const STRINGS = {
  ko: {
    btn_menu: '메뉴', pause_title: '일시정지', pause_show_hands: '양손을 화면에 보여주면 이어서 시작해요',
    aria_ranking: '랭킹', aria_settings: '설정',
    lobby_title: '모션 레이싱', lobby_subtitle: '양손으로 핸들을 잡고 기울여 조종하세요',
    btn_play: '플레이', btn_practice: '연습 모드 · 장애물 없음', aria_close: '닫기',
    wizard_step_vehicle: '차량 선택', btn_next: '다음', wizard_step_map: '맵 선택', btn_back: '뒤로',
    wizard_step_difficulty: '난이도 · 시점', aria_difficulty: '난이도 선택', label_difficulty: '난이도',
    diff_easy: '쉬움', diff_medium: '중간', diff_hard: '어려움',
    aria_view: '시점 선택', label_view: '시점', view_3rd: '3인칭', view_1st: '1인칭 (운전석)',
    wizard_tip: '양손으로 핸들을 잡고 기울여 조종 · 손이 안 잡히면 뒤로 앉아 두 손을 화면에',
    btn_start: '게임 시작', settings_title: '설정', setting_sensitivity: '핸들 감도',
    btn_fullscreen: '전체화면 (모바일 권장)', settings_note: '웹캠 권한 필요 · localhost 또는 https 에서 실행',
    btn_close: '닫기', gameover_title: '게임 오버', new_record: '신기록!',
    btn_home: '로비로 가기', btn_view_ranking: '랭킹 보기', btn_resume: '이어서 하기',
    nick_welcome: '환영합니다', nick_prompt: '랭킹에 표시될 닉네임을 정해주세요', nick_placeholder: '1~12자',
    btn_nick_start: '시작', nick_edit_title: '닉네임 변경', nick_edit_prompt: '새 닉네임을 입력하세요', btn_save: '저장',
    rank_title: '랭킹', rank_global_heading: '전체 랭킹', rank_my_heading: '내 기록',
    hint_no_hands: '손이 감지되지 않으면 화면에 양손을 보여주세요', rotate_hint: '가로로 눕혀서 플레이하세요',
    lang_label: '언어', default_nickname: '플레이어',
    stat_speed: '속도', stat_accel: '가속', stat_handling: '조향',
    status_camera_prep: '카메라 준비 중... 권한을 허용해 주세요',
    err_camera_suffix: ' — 카메라 권한을 허용하고 localhost 또는 https 에서 실행하세요.',
    err_camera_default: '카메라를 시작하지 못했습니다.',
    rank_my_empty: '이 난이도 기록이 없어요', rank_loading: '불러오는 중...',
    rank_global_empty: '아직 기록이 없어요', rank_my_rank: '내 순위: {n}위 · 최고 {best} m',
    rank_offline: '전체 랭킹은 서버 연결 후 표시돼요', status_show_hands: '양손을 화면에 보여주세요',
    veh_sports: '스포츠카', veh_super: '슈퍼카', veh_classic: '클래식',
    map_newyork: '뉴욕', map_paris: '파리', map_tokyo: '도쿄', map_seoul: '서울', map_neon: '네온 시티',
    time_day: '낮', time_sunset: '노을', time_night: '야간', time_evening: '저녁', time_midnight: '밤',
    hud_distance: '거리: {n} m', hud_final: '최종 거리: {n} m', hud_practice: '연습', hud_speed: '속도: {n} km/h',
    err_camera: '카메라를 사용할 수 없습니다. 카메라 권한을 허용하고 localhost 또는 https 환경에서 실행하세요.',
    err_model_load: '손 인식 모델을 불러오지 못했습니다. 인터넷 연결을 확인하세요.',
  },
  en: {
    btn_menu: 'Menu', pause_title: 'Paused', pause_show_hands: 'Show both hands to resume',
    aria_ranking: 'Ranking', aria_settings: 'Settings',
    lobby_title: 'Motion Racing', lobby_subtitle: 'Grip an invisible wheel with both hands and tilt to steer',
    btn_play: 'Play', btn_practice: 'Practice · No obstacles', aria_close: 'Close',
    wizard_step_vehicle: 'Choose a car', btn_next: 'Next', wizard_step_map: 'Choose a map', btn_back: 'Back',
    wizard_step_difficulty: 'Difficulty · View', aria_difficulty: 'Select difficulty', label_difficulty: 'Difficulty',
    diff_easy: 'Easy', diff_medium: 'Normal', diff_hard: 'Hard',
    aria_view: 'Select view', label_view: 'View', view_3rd: '3rd person', view_1st: '1st person (cockpit)',
    wizard_tip: 'Grip the wheel with both hands and tilt · If tracking drops, sit back so both hands are in frame',
    btn_start: 'Start', settings_title: 'Settings', setting_sensitivity: 'Steering sensitivity',
    btn_fullscreen: 'Fullscreen (recommended on mobile)', settings_note: 'Webcam permission required · run on localhost or https',
    btn_close: 'Close', gameover_title: 'Game Over', new_record: 'New record!',
    btn_home: 'Back to lobby', btn_view_ranking: 'View ranking', btn_resume: 'Resume',
    nick_welcome: 'Welcome', nick_prompt: 'Pick a nickname for the leaderboard', nick_placeholder: '1–12 characters',
    btn_nick_start: 'Start', nick_edit_title: 'Change nickname', nick_edit_prompt: 'Enter a new nickname', btn_save: 'Save',
    rank_title: 'Ranking', rank_global_heading: 'Global ranking', rank_my_heading: 'My records',
    hint_no_hands: "If your hands aren't detected, show both hands to the camera", rotate_hint: 'Rotate to landscape to play',
    lang_label: 'Language', default_nickname: 'Player',
    stat_speed: 'Speed', stat_accel: 'Accel', stat_handling: 'Handling',
    status_camera_prep: 'Preparing camera… please allow access',
    err_camera_suffix: ' — Allow camera access and run on localhost or https.',
    err_camera_default: "Couldn't start the camera.",
    rank_my_empty: 'No records at this difficulty yet', rank_loading: 'Loading…',
    rank_global_empty: 'No records yet', rank_my_rank: 'Your rank: #{n} · best {best} m',
    rank_offline: 'Global ranking appears once connected to the server', status_show_hands: 'Show both hands to the camera',
    veh_sports: 'Sports', veh_super: 'Super', veh_classic: 'Classic',
    map_newyork: 'New York', map_paris: 'Paris', map_tokyo: 'Tokyo', map_seoul: 'Seoul', map_neon: 'Neon City',
    time_day: 'Day', time_sunset: 'Sunset', time_night: 'Night', time_evening: 'Evening', time_midnight: 'Night',
    hud_distance: 'Distance: {n} m', hud_final: 'Distance: {n} m', hud_practice: 'Practice', hud_speed: 'Speed: {n} km/h',
    err_camera: 'Camera unavailable. Allow camera access and run on localhost or https.',
    err_model_load: "Couldn't load the hand-tracking model. Check your internet connection.",
  },
};

let lang = 'ko';
export function getLang() { return lang; }
export function initLang() {
  let saved = null;
  try { saved = localStorage.getItem('mr-lang'); } catch {}
  if (saved === 'ko' || saved === 'en') lang = saved;
  else lang = (navigator.language || 'en').toLowerCase().startsWith('ko') ? 'ko' : 'en';
  return lang;
}
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'ko';
  try { localStorage.setItem('mr-lang', lang); } catch {}
  applyI18n();
}
export function t(key, vars) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) ?? (STRINGS.ko[key] ?? key);
  if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  return s;
}
// Apply translations to static markup: data-i18n (text), -aria (aria-label), -ph (placeholder).
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.setAttribute('placeholder', t(el.dataset.i18nPh));
  document.documentElement.lang = lang;
}
