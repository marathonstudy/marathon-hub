# 러닝노트 캐릭터 그림 (20261110b)

- 파일 이름 = `<id>.svg` (game.js `CHARS` 의 id) — 같은 이름으로 바꾸면 그림만 바뀐다
- PNG 로 바꿀 때: `<id>.png` (512×512 · 투명 배경 · 얼굴이 가운데)를 넣고 game.js `CHAR_FILES` 에 `{ <id>: '<id>.png' }`
- 다시 만들기: `node tools/make-chars.cjs` (그림체: 둥근 얼굴 · 보라 셔츠 · 번호표 · 머리띠)

| id | 이름 |
|---|---|
| maratoni | 마라토니(마스코트 · 임시 그림) |
| marabugi | 마라부기(마스코트 · 임시 그림) |
| rabbit | 토끼 |
| turtle | 거북 |
| cheetah | 치타 |
| penguin | 펭귄 |
| fox | 여우 |
| bear | 곰 |
| cat | 고양이 |
| dog | 강아지 |
| otter | 수달 |
| owl | 부엉이 |
| squirrel | 다람쥐 |
| hedgehog | 고슴도치 |

## 넣어야 할 마스코트 그림
- `maratoni.png` — 마라토니 · 512×512 · 투명 배경 PNG
- `marabugi.png` — 마라부기 · 512×512 · 투명 배경 PNG
