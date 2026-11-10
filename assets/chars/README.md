# 러닝노트 캐릭터 그림 (20261110b)

- 파일 이름 = `<id>.svg` (game.js `CHARS` 의 id) — 같은 이름으로 바꾸면 그림만 바뀐다
- PNG 로 바꿀 때: `<id>.png` (512×512 · 투명 배경 · 얼굴이 가운데)를 넣고 game.js `CHAR_FILES` 에 `{ <id>: '<id>.png' }`
- 다시 만들기: `node tools/make-chars.cjs` (그림체: 둥근 얼굴 · 보라 셔츠 · 번호표 · 머리띠)

| id | 이름 |
|---|---|
| maratoni | 마라토니(마스코트 · 진짜 그림 maratoni.png · 이 SVG 는 예비) |
| marabugi | 마라부기(마스코트 · 진짜 그림 marabugi.png · 이 SVG 는 예비) |
| deer | 사슴 |
| koala | 코알라 |
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

## 마스코트 그림 (20261110f)
- `maratoni.png` — 마라토니(토끼) · 512×512 · 투명 배경 · 원본 「클로드 코드\marathon\marathon\char-rabbit.png」(1254px)을 몸 전체가 가운데 오게 줄임
- `marabugi.png` — 마라부기(거북) · 512×512 · 투명 배경 · 원본 「클로드 코드\marathon\marathon\char-turtle.png」
- game.js `CHAR_FILES` 에 연결돼 있다 · 토끼 · 거북은 마스코트라 동물 러너에서 빼고 사슴(deer) · 코알라(koala)로 바꿈
