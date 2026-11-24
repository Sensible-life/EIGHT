# 디스플레이 디자인 조절 안내

디스플레이 화면(`/display`, `/display/<방>`, `/display/demo`)의 색·크기·위치·문구·모양을 바꾸는 방법이다. 화면이 어떻게 동작하는지(인식, 캐릭터가 묻는 규칙, 방)는 [CREATIVE_DISPLAY.md](CREATIVE_DISPLAY.md)에 있다.

거의 모든 것이 `server/app/display.html` 한 파일에 있다. 서버는 이 파일을 요청마다 새로 읽으므로 **저장하고 브라우저를 새로고침하면 바로 바뀐다**(서버 재시작 불필요).

## 바꿔 보면서 확인하기

1. 서버를 직접 연 터미널에서 띄운다.
   - Mac: `cd server && ./run.sh`
   - 음악 분석 라이브러리(librosa)가 없는 PC에서는 디스플레이 부분만:
     ```
     cd server
     python -c "import uvicorn; from fastapi import FastAPI; from app.projection import router; a=FastAPI(); a.include_router(router); uvicorn.run(a, host='127.0.0.1', port=8000)"
     ```
2. `http://localhost:8000/display/demo`를 연다. 카메라 없이 가상 댄서가 춤을 춘다. 시작 후 30초쯤 안에 캐릭터가 궤도를 돌다 내려앉아 묻고, O로 답하고, 제안을 시도하는 흐름이 한 번 돈다.
3. 키: `L` 라벨, `D` 디버그 창, `Y`/`N` 대답. 마우스를 움직이면 아래에 버튼 바가 뜬다(EN/KO, Demo, Moves).
4. 개발자 도구(F12)에서 `:root`의 값을 바꿔 보고, 마음에 드는 값을 파일에 옮겨 적으면 편하다.

## 디자인 값 (`display.html` 맨 위 `Design values` 블록)

- 크기와 위치는 **Figma 1280×720 프레임 기준 px**이다. Figma에서 읽은 숫자를 그대로 넣으면 화면 크기에 맞게 늘거나 줄어든다.
- 색은 `#rrggbb`, 투명도가 필요하면 `#rrggbbaa`.
- 위치 값 여러 개는 공백으로 구분한다(예: `513 178 420 124`).

### 배경

| 값 | 기본 | 뜻 |
|---|---|---|
| `--bg-center` / `--bg-inner` / `--bg-outer` / `--bg-edge` | `#282244` / `#221d3d` / `#1e1936` / `#1a1730` | 가운데에서 가장자리로 어두워지는 배경 |
| `--font` | Manrope, Pretendard, … | 글꼴 |

### 8

| 값 | 기본 | 뜻 |
|---|---|---|
| `--eight-used` / `--eight-middle` / `--eight-unused` | `#cdacd9` / `#8e88d8` / `#4c61d5` | 많이 쓴 부위(핑크) / 고르게 쓴 부위 / 안 쓴 부위(파랑) |
| `--eight-full-at` | `.15` | 민감도. 고른 비율(25%)보다 이만큼 많거나(40%) 적으면(10%) 완전한 핑크·파랑. 작을수록 민감 |
| `--eight-now` | `.7` | 최근 4초를 섞는 비율(1이면 4초만, 0이면 30초만). 높을수록 빠르지만 깜빡이듯 바뀐다 |
| `--eight-fade` | `.6` | 한 색에서 다음 색으로 넘어가는 시간(초) |
| `--eight-shadow-color` / `-y` / `-blur` | `#8f8ca699` / `4` / `4` | 그림자 색, 아래로 내려간 거리, 번짐 |
| `--eight-idle-opacity` | `.5` | 아무도 인식되지 않을 때의 흐린 정도 |

**색이 바뀌는 방식**: 8의 네 모서리가 팔다리 하나씩이다(위가 팔, 아래가 다리, 화면이 거울이라 댄서의 왼쪽이 화면 왼쪽). 각 팔다리가 팔다리 전체 움직임에서 차지한 비율로 색이 정해진다. 충분히 보이지 않은 부위는 "안 씀"이 아니므로 파랑이 아니라 중간색이다. 아무도 없을 때는 디자인 그대로(위 핑크, 아래 파랑) 흐리게 보인다.

**색을 더 빠르게**: `--eight-now`를 0.85~1로, `--eight-fade`를 0.3 정도로 낮춘다. 4초라는 길이는 인식 코드의 8카운트 창(`app/src/tracking/config.ts`의 `'8count_s'`)이고 "시도했어요" 판단에도 쓰이므로 바꾸지 않는 편이 좋다.

### 라벨 (`L`)

| 값 | 기본 | 뜻 |
|---|---|---|
| `--label-name-size` / `-color` | `22` / `#cdc6ec` | 부위 이름(Left Arm) |
| `--label-kind-size` / `-color` | `46` / `#ffffff` | 동작(Reach ↑) |
| `--label-kind-hold-color` / `--label-kind-unseen-color` | `#cfc9ea` / `#8f89b3` | 멈춤 / 안 보임일 때 동작 글자 색 |
| `--label-detail-size` / `-color` | `20` / `#ddd7f6` | 세부(빠르게 · 크게 · …) |
| `--label-lack-size` / `-color` | `20` / `#ffb3c7` | "less used" 표시와 덜 쓴 곳 줄 |
| `--label-line-color` / `-width` | `#cfc9ecb3` / `1.4` | 지시선 |
| `--label-dot-color` / `-size` | `#f1edff` / `3.5` | 8 위의 점 |
| `--label-arm-l`, `--label-arm-r`, `--label-torso`, `--label-leg-l`, `--label-leg-r` | 예: `513 178 420 124` | **8 위 점의 x y**, 그다음 **선이 꺾이는 곳의 x y**. 글자는 꺾인 선 위에 놓이고, 꺾이는 곳이 점보다 왼쪽이면 글자가 왼쪽으로 자란다 |
| `--label-rows-arms` / `-legs` / `-torso` | `62 110 152` / `564 610 652` / `292 338 380 408 436` | 각 줄의 글자 기준선 y: 이름, 동작, 세부(몸통은 공간, 덜 쓴 곳 줄까지) |

### 캐릭터와 궤도

| 값 | 기본 | 뜻 |
|---|---|---|
| `--buddy-x` / `--buddy-y` | `331` / `517` | 캐릭터 자리: 가운데 x, 발끝 y |
| `--buddy-width` | `46` | 캐릭터 폭(높이는 비율대로) |
| `--buddy-top` / `-middle` / `-bottom` | `#c2cdfb` / `#cbcdfa` / `#e4c6f3` | 몸통 그라데이션 |
| `--buddy-glow` | `#e9e4ff80` | 아래로 번지는 빛 |
| `--orbit` | `640 380 330 74 -10 7` | 궤도: 중심 x y, 반지름 x y, 기울기(도), 한 바퀴 걸리는 초 |
| `--orbit-from` | `.35` | 물을 때까지 이만큼(0~1) 가까워지면 궤도에 희미하게 나타나기 시작 |

**캐릭터의 움직임**: 물을 때가 가까워질수록(서버가 보내는 `agent.soon`) 8 둘레를 기울어진 궤도로 돌며 또렷해진다. 아래쪽은 8 앞, 위쪽은 8 뒤로 지나가며 작고 흐려진다. 할 말이 생기면 가로질러 오지 않고 궤도를 따라 자기 자리에 가장 가까운 지점까지 돈 뒤(멀면 조금 빨라져서 최대 3초) 내려앉고, 말풍선이 뜬다. 최대 3초는 코드의 `ARRIVE_S`다. 움직임 줄이기 설정을 켠 기기에서는 궤도 없이 자리에 바로 나타난다.

### 말풍선

| 값 | 기본 | 뜻 |
|---|---|---|
| `--bubble-gap` | `31` | 말풍선과 캐릭터 사이 |
| `--bubble-font-size` / `--bubble-text-color` | `19` / `#ffffff` | 글자 |
| `--bubble-max-width` | `282` | 이보다 길면 두 줄로 |
| `--bubble-padding-y` / `-x` | `14` / `28` | 안쪽 여백 |
| `--bubble-color-1` / `-2` / `-3` | `#aaa6d6` / `#a2b2de` / `#c6a3cf` | 왼쪽 위에서 오른쪽 아래로 가는 그라데이션(꼬리까지 이어진다) |
| `--bubble-tail-width` / `-height` | `18` / `12` | 꼬리 크기 |
| `--ask-width` / `--ask-height` | `92` / `40` | 물을 때의 "…" 말풍선 크기 |
| `--ask-dot-size` / `--ask-badge-size` | `9` / `16` | 점 세 개(O를 1초 유지할 때마다 하나씩 켜진다), 오른쪽 위 흰 점 |

### 안내 문구와 기타

| 값 | 기본 | 뜻 |
|---|---|---|
| `--notice-y` | `12` | "3초 동안 가만히 서 주세요" 등의 위쪽 거리 |
| `--notice-font-size` / `--notice-sub-size` | `24` / `14` | 큰 글자 / 작은 설명 |
| `--notice-bg` | `#2a2450dd` | 안내 배경 |
| `--ink` / `--muted` / `--line` / `--panel` | | 버튼 바와 디버그 창 |

## 글자 바꾸기 (`display.html`의 `TEXT` 표)

`TEXT.en`(영어, 기본)과 `TEXT.ko`(한국어)가 같은 모양으로 있다.

| 항목 | 무엇 |
|---|---|
| `suggest` | 캐릭터의 제안. 대상별(arm_l, …, low, high, left, right) 한 문장 |
| `states` | 짧은 대답: `explored`(You tried it!), `unanswered`(Maybe later.), `accepted`, `dismissed` |
| `label` | 라벨 단어: 부위 이름, 동작(kinds), 속도·크기·질감·박자, 공간, 덜 쓴 곳 |
| `notices` | 안내 문구(가만히 서기, 화면 안으로, 카메라 권한 등) |
| `status`, `on`/`off`, `labels`, `debug`, `demo`, `moves`, `yes`/`notNow`… | 버튼 바 |

**주의: 영어 제안 문구는 서버에도 있다.** 제안 문장은 서버(`server/app/display_agent.py`의 `LocalPromptGenerator.PROMPTS` title)가 정해서 보낸다. 화면은 그 문장이 `TEXT.en.suggest`와 같을 때만 고른 언어(한국어 등)로 바꿔 보여 준다. 그래서 **영어 제안 문구를 고치면 두 곳을 똑같이 고쳐야** 한다. 다르면 한국어 모드에서도 서버의 영어 문장이 그대로 뜬다(나중에 다른 생성기, 예를 들어 AI 모델이 만든 문장도 이렇게 그대로 보이도록 한 것이다). 한국어 문구만 고칠 때는 `TEXT.ko.suggest`만 고치면 된다.

동작 설명 페이지(`/display/moves`)의 제목·설명은 `server/app/moves.html`의 `TEXT`에 따로 있다.

## 모양 바꾸기

### 8 모양

- 위치: `display.html`의 `<clipPath id="eight-shape">` 안 `<path d="…">`. 지금 path는 디자인 이미지(default.png)를 따라 그린 것이다.
- 바꾸는 법: Figma에서 **1280×720 프레임 그대로** 8을 SVG로 내보내고, 그 path의 `d` 값을 넣는다. 8만 따로 내보내면 좌표가 프레임 기준이 아니므로 위치를 옮겨야 한다. 가운데가 뚫린 모양이라 `clip-rule="evenodd"`는 그대로 둔다.
- 내보낸 SVG의 채우기 색은 쓰이지 않는다. path는 윤곽으로만 쓰이고, 색은 그라데이션이 칠한다. 그림자도 같은 path(`id="eight-outline"`)를 가져다 쓰는 별도 층이라 따로 고칠 필요가 없다(색이 바뀔 때마다 그림자를 다시 흐리게 그리지 않으려고 나눠 두었다).
- 모양이나 크기가 크게 달라지면 같이 맞출 것:
  - 그라데이션 범위: 바로 위 `eight-left`·`eight-right`의 `y1="104" y2="651"`(8의 위·아래 끝), `eight-across`의 `x1="459" x2="820"`(왼쪽·오른쪽 끝)
  - 색을 칠하는 사각형: `<rect x="440" y="90" width="400" height="580">` 두 개(8을 다 덮으면 된다)
  - 라벨 점 위치 `--label-*`, 궤도 `--orbit`

### 캐릭터 모양

- 위치: `display.html`의 `<svg class="buddy" viewBox="0 0 44 54">`. 몸통 path, 눈 두 개(circle), 입(path)으로 되어 있다.
- 바꾸는 법: Figma에서 캐릭터를 SVG로 내보내 안의 내용과 `viewBox`를 통째로 바꾼다. 몸통의 채우기를 `fill="url(#buddy-fill)"`로 두면 `--buddy-*` 색이 그대로 먹는다. 크기·위치·빛은 계속 디자인 값으로 조절된다.

### 말풍선 모양

- `display.html`의 `shapeBubble()`이 말풍선 크기에 맞춰 둥근 몸통과 꼬리를 한 윤곽으로 그린다(그래서 그라데이션과 그림자가 꼬리까지 이어진다).
- 꼬리 크기·색은 디자인 값으로 바꾼다. 모서리 둥글기 등 모양 자체는 이 함수의 반지름 `r`(지금은 높이의 절반, 즉 알약 모양)을 고친다.

## 관련 파일

| 파일 | 무엇 |
|---|---|
| `server/app/display.html` | 디스플레이 화면 전부(디자인 값, 글자, 8, 캐릭터, 말풍선, 데모 진행) |
| `server/app/moves.html` | 동작 설명 페이지 |
| `server/app/display_agent.py` | 캐릭터가 언제 무엇을 물을지, 영어 제안 문구(`PROMPTS`) |
| `app/src/tracking/figures.ts` | 가상 댄서(데모와 동작 설명 페이지의 움직임) |
| `app/src/tracking/config.ts` | 인식 기준값(`labels`: 동작 단어, `labels.step`: 스텝, `answer`: O, `targets`). 동작 단어 기준값을 바꾸는 법과 변경 기록: [TRACKING.md](TRACKING.md#디스플레이의-동작-단어-정하는-법과-기준값-바꾸기) |

`app/src/tracking/`의 코드를 바꾸면 `app/`에서 `npm run build:display`로 `server/app/static/tracking.js`를 다시 만들어야 화면에 반영된다. `display.html`·`moves.html`만 바꿀 때는 필요 없다.
