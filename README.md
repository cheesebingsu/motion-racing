# 모션 레이싱 (Motion Racing)

웹캠으로 **양손 핸들 포즈**를 인식해 조종하는 엔드리스 레이싱 게임.
바닐라 JavaScript + HTML + Canvas 2D, 손 인식은 MediaPipe HandLandmarker(Tasks Vision).

## 플레이 방법
1. **게임 시작** → 카메라 권한 허용
2. 양손으로 보이지 않는 **핸들**을 잡고, 기울이면 차가 좌우로 움직입니다
3. 자동 가속 — 장애물을 피하세요. 생명 3개, 오래 버틸수록 점수(거리)가 올라갑니다

- 난이도(쉬움/중간/어려움), 핸들 감도 조절, 연습 모드 지원
- 손이 화면에서 사라지면 자동 일시정지 → 다시 잡으면 3초 후 이어서 시작
- **폰은 가로로 눕혀서** 플레이하세요

## 실행
정적 사이트라 브라우저에서 바로 열립니다. 단, **웹캠은 `https://` 또는 `http://localhost`** 에서만 동작합니다(`file://` 직접 열기는 카메라 불가).

로컬 실행 예:
```
python -m http.server 8123
# http://localhost:8123/
```

## 파일 구조
- `index.html` — 구조 · 화면(시작/게임오버/일시정지) · HUD
- `js/hand-tracking.js` — MediaPipe 손 인식 → 조향값
- `js/game.js` — 유사 3D 도로 렌더링 · 게임 로직
- `js/main.js` — 배선(카메라·게임·UI)
- `style.css` — 네온 아케이드 스타일
