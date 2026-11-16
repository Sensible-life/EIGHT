# ChoreoLayer IA 정리 · 구현 지시서

> 이 문서는 다른 코딩 에이전트(GPT 등)에게 넘기기 위한 작업 지시서다. 레포: `Sensible-life/EIGHT`, 앱은 `app/` (Expo SDK 57, React Native 0.86, expo-router).
> 작성일 2026-10-28. 기준 커밋 `3bd32dc` + 아래 "미커밋 변경" 상태.

---

## 0. 먼저 읽을 것

| 문서 | 내용 |
|---|---|
| `README.md` | 서버·앱 실행, 음악 분석 JSON 형식 |
| `docs/TRACKING.md` | 카메라 트래킹 구조, **원칙 4가지**, 메시지 형식, 테스트 방법 |
| `docs/FEATURE_STATUS.md` | 화면별 현재 기능과 남은 일 |
| `app/AGENTS.md` | Expo 작업 규칙 (expo install, 타입체크·lint 필수) |

### 반드시 지킬 제약
1. **Expo Go로는 실행 불가.** `react-native-audio-api`, `modules/pose-camera`(Kotlin+MediaPipe), `modules/watch-haptics`가 네이티브 모듈이라 dev build가 필요하다. 웹(`npm run web`)과 iOS에서는 카메라·워치 기능이 `null`이 되므로 **항상 대체 UI를 둔다** (`PoseCameraView`가 `null`이면 안내 문구).
2. **트래킹 원칙 (TRACKING.md)**: 점수·순위·"맞는 동작" 없음 / "부족함" 대신 "안 가본 쪽" / 영상·관절 좌표는 저장하지 않고 **집계 숫자만** 저장 / 가려진 부위는 "안 쓴 것"이 아님. 빨간색·경고 표현 금지.
3. `src/tracking/`은 React 없는 순수 TS다. 여기에 React·RN import를 넣지 않는다 (node 테스트가 `scripts/load-ts.cjs`로 직접 로드).
4. 저장 형식을 바꾸면 `src/state/validation.ts`의 `validateLibrary`도 함께 바꾼다. **새 필드는 optional + 기본값**으로 넣어 기존 저장 데이터·백업 JSON이 깨지지 않게 한다.
5. UI 문구는 한국어, 기존 톤(존댓말·짧은 문장) 유지. 스타일은 `src/theme.ts`의 `C`, `src/ui/Kit.tsx`의 `ui`·`Card`·`Button`·`Section` 재사용.

### 완료 기준 (모든 작업 공통)
```bash
cd app
npm run typecheck
npm run lint
npm run test:tracking      # 트래킹 로직 + id403 정답 비교
npm run test:library       # 저장 형식을 건드렸다면
```

---

## 1. 목표 IA

팀이 정한 IA(5개 탭)는 유지한다. **굵게** 표시한 노드가 이번에 추가·변경하는 부분이다.

```
App
├─ Home
│   ├─ Weekly Mission Preview
│   ├─ Recommendation          ← "자주 안 가본 쪽" 기반 다음 연습 제안 (신규 내용)
│   └─ Insights Preview        ← 몸 히트맵 미니 버전 추가
├─ Workspace
│   ├─ Projects
│   │   ├─ Music
│   │   └─ Sessions
│   ├─ Mission History
│   ├─ Saved                   ← 저장한 프로젝트 + **저장한 모티프(8카운트)**
│   └─ **Compose** (2단계)      ← 모티프를 순서대로 배치
├─ Analysis                    ← **기록만** 보여준다 (실시간 카메라 없음)
│   ├─ Body (신체 부위)          ← 몸 히트맵 + 높이 + 자주 안 가본 쪽 (카드 1개로 통합)
│   ├─ Music (음악 레이어)
│   ├─ 동일 패턴 반복 여부        ← 카메라 동작 횟수 + (영상 분석)
│   └─ Space (공간 활용)
├─ Mission
│   ├─ Weekly Mission
│   ├─ Monthly Mission         ← 미구현
│   └─ Explore                 ← 현재 community 화면
└─ Start New Session
    ├─ Select Music
    ├─ Device Connection       ← 워치 + **카메라(몸 인식)** 연결 상태
    └─ **Session**              ← IA 트리에 없던 노드. 춤추는 화면(흐름도의 Creative Space)
        ├─ 레이어 믹서
        ├─ **실시간 몸 히트맵** + 안 가본 쪽 제안
        └─ **[이 8카운트 저장]** → Workspace > Saved
```

### 핵심 원칙
- **라이브(카메라 실시간)는 Session 안에만 둔다.** Home·Workspace·Analysis·Mission은 모두 저장된 기록만 다룬다.
- 시스템 흐름도와의 대응: Session = Creative Space (카메라·오디오·AI Intervention), 나머지 탭 = Choreography Workspace (Explore → Select → Compose, Weekly mission, Review).
- 흐름도의 "마음에 드는가? → YES: 움직임 저장"이 **[이 8카운트 저장]** 버튼이다. 저장 단위를 8카운트로 두면 음악 분석(`analysis.eights`), 트래킹 집계 창(`8count`), Compose가 모두 같은 단위로 이어진다.

---

## 2. 현재 코드와 IA 대응표

라우트는 `app/src/app/*.tsx` (expo-router). 하단 탭은 `_layout.tsx`의 `tabs` 배열.

| IA 노드 | 현재 파일 | 상태 |
|---|---|---|
| Home | `app/index.tsx` | 미션 카드, 최근 세션 이어하기, 인사이트(재생 분·마친 세션 수)만 있음. Recommendation 없음 |
| Workspace > Projects / Sessions | `app/workspace.tsx`(탭 `projects`), `app/project.tsx` | 있음. project 화면에 "영상 · 동작 분석 스튜디오" 진입 버튼 있음 |
| Workspace > Mission History | `app/workspace.tsx`(탭 `history`) | 있음 |
| Workspace > Saved | `app/workspace.tsx`(탭 `saved`) | `project.saved === true`인 프로젝트만. 모티프 없음 |
| Workspace > Compose | — | 없음 |
| Analysis > Body | `app/analysis.tsx` + `components/tracking/LiveBodyCard.tsx`(미커밋) + `TrackingInsightCard.tsx` | **카드 2개로 중복**, LiveBodyCard에 실시간 카메라 버튼이 있음 → 정리 대상 |
| Analysis > Music | `app/analysis.tsx` (`layerShares`) | 있음 |
| Analysis > 동일 패턴 반복 | `TrackingMovesCard.tsx` + 움직임 스튜디오 결과 카드 | 있음 (두 출처 혼재) |
| Analysis > Space | `TrackingSpaceCard.tsx` + 움직임 스튜디오 3×3 카드 | 있음 (두 출처 혼재) |
| Mission > Weekly | `app/mission.tsx` | 있음 |
| Mission > Monthly | — | 없음 |
| Mission > Explore | `app/community.tsx` (mission에서 버튼으로 진입) | 로컬 샘플 피드 |
| Start New Session > Select Music | `app/new-session.tsx` → `screens/HomeScreen.tsx` | 있음 (단계 표시 01/02/03) |
| Start New Session > Device Connection | `app/device.tsx` | **워치만**. 카메라 없음 |
| Session | `app/session.tsx` → `screens/PlayerScreen.tsx` | `[믹서 | 카메라]` 탭. 카메라 탭 = `components/tracking/CameraTab.tsx` (부위 **막대그래프**) |
| (IA 밖) 움직임 스튜디오 | `app/motion.tsx`, `src/motion/analyze.ts` | 좌표 JSON·샘플로 분석. 카메라 트래킹과 기능 중복, IA 노드 없음 |
| (IA 밖) 설정 | `app/settings.tsx` | 헤더 우측 버튼. 유지 |

### 미커밋 변경 (작업 시작 전 상태)
```
 M app/src/app/analysis.tsx                        Body 카드를 LiveBodyCard로 교체
?? app/src/tracking/bodyMap.ts                     히트맵용 순수 로직 (퍼센트 합 100, 색 농도, 스튜디오→6부위 변환, liveClock)
?? app/src/components/tracking/BodyHeatmap.tsx     몸 그림 SVG 히트맵 (6부위, 거울 기준: 춤추는 사람의 왼쪽 = 화면 왼쪽)
?? app/src/components/tracking/LiveBodyCard.tsx    분석 탭 Body 카드 (기록 히트맵 + 실시간 카메라 모드)
?? app/scripts/tracking/bodyMap.test.cjs           위 로직 테스트 (통과)
```
`bodyMap.ts`·`BodyHeatmap.tsx`는 그대로 재사용한다. `LiveBodyCard.tsx`의 실시간 부분은 작업 1·2에서 Session으로 옮긴다.

---

## 3. 작업 목록 (우선순위 순)

각 작업은 독립 커밋으로 나눈다. 1~4가 1단계(이번 스프린트), 5~8이 2단계.

### 작업 1. Analysis > Body를 "기록 전용" 카드 1개로 통합
**목표**: 분석 탭에서 실시간 카메라를 없애고, Body 섹션을 히트맵 카드 하나로 합친다.

- `LiveBodyCard.tsx` → `BodyBalanceCard.tsx`로 이름 변경. `LiveView`·카메라 관련 코드(`PoseCameraView`, `LiveTrackingStore`, 권한 처리, `[카메라로 실시간 보기]`) 삭제.
- 카드 내용 (위→아래):
  1. `BodyHeatmap` (`savedShares()` 로직 유지: 카메라 기록 → 없으면 움직임 스튜디오 최근 결과 → 없으면 빈 상태)
  2. "가장 많이 쓴 부위 · 가장 조용한 부위" (`extremes()`)
  3. 높이 비율 (`TrackingInsightCard`에 있던 `LEVEL_NAMES` 줄)
  4. "자주 안 가본 쪽" 목록 (`TrackingInsightCard`의 `insight.unexplored`)
  5. 빈 상태일 때 버튼 "세션에서 카메라로 춤추기" → `router.push('/new-session')`
- `analysis.tsx`에서 `Section "Body · 카메라 트래킹"` + `TrackingInsightCard` 제거. `TrackingInsightCard.tsx`는 다른 곳에서 안 쓰면 삭제.
- 수용 기준: 분석 탭에 카메라를 켜는 UI가 없다. 카메라 기록이 있는 세션(30초 이상)이 있으면 히트맵 퍼센트 합이 100이다.

### 작업 2. Session 카메라 탭에 실시간 몸 히트맵
**목표**: 춤추는 중에 보는 화면에서 막대그래프 대신 몸 그림 히트맵을 보여준다.

- 파일: `components/tracking/CameraTab.tsx`
- `BodyUsageBars` 자리에 `<BodyHeatmap shares={fromSegments(usage.segments)} underused={usage.underused} dim={dim} />`.
  - 기존 `이번 8카운트 | 세션 전체` 스위치, `dim` 규칙(재생 중 + tracking_ok + state==='tracking'일 때만 진하게)은 그대로.
  - 카메라 미리보기(3:4) 아래에 히트맵을 두면 세로가 길어진다. 미리보기와 히트맵을 **가로로 나란히**(미리보기 왼쪽 45%, 히트맵 오른쪽) 배치하는 것을 우선 시도. 2.5~3m 거리에서 퍼센트가 읽혀야 하므로 히트맵 숫자는 최소 18pt.
- `BodyUsageBars.tsx`는 접근성 대체용으로 남긴다: 히트맵 아래 "자세히" 토글로 펼침.
- 데이터는 이미 `store.getView().usage[window].segments`(0~1, 합 1)로 들어온다. 새 계산 로직 불필요.
- 수용 기준: 웹/iOS에서는 기존 "Android 앱에서만" 안내가 그대로 나온다. `npm run test:tracking` 통과.

### 작업 3. Device Connection에 카메라 추가
**목표**: IA의 Device Connection을 "워치 + 카메라" 연결 화면으로 만든다.

- 파일: `app/device.tsx`
- 기존 Galaxy Watch 카드 아래에 "몸 인식 카메라" 카드 추가:
  - 상태: `PoseCameraView === null` → "Android 앱에서 쓸 수 있어요" / 권한 미허용 → [카메라 권한 허용] 버튼 (`ImagePicker.requestCameraPermissionsAsync`, `CameraTab`과 같은 방식) / 허용됨 → "준비됨 · 폰을 세워 두고 전신이 보이게".
  - 카메라를 여기서 켜지는 않는다 (권한·안내만). 실제 카메라는 Session 카메라 탭에서만 켠다.
- 하단 시작 버튼 문구: 워치·카메라 상태와 무관하게 "세션 시작하기" 하나로 통일하고, 연결 안 된 장치는 버튼 위에 작은 글씨로 표시.
- 장치 추상화(나중에 앰프 하드웨어 카메라 추가 대비): `modules/pose-camera/.../FrameSource.kt`가 이미 카메라 소스 인터페이스다. 이번 작업에서 네이티브는 건드리지 않는다.

### 작업 4. [이 8카운트 저장] = 모티프 저장 + Workspace > Saved
**목표**: 흐름도의 "마음에 드는가? → YES: 움직임 저장"을 구현한다.

**데이터 모델** (`src/state/extras.ts`):
```ts
export type Motif = {
  id: string;            // `motif-${Date.now()}`
  projectId: string;     // 곡
  sessionId?: string;
  name: string;          // 기본: `${곡 이름} · ${eightIndex + 1}번째 8카운트`
  createdAt: number;
  start: number; end: number;   // 곡 내 초 (analysis.eights 기준, 없으면 BPM/4초 격자)
  eightIndex: number | null;    // analysis.eights의 index, 격자일 때 null
  body?: Record<Segment, number>;            // 그 8카운트의 부위 비율 (usage['8count'].segments), 카메라 안 썼으면 없음
  level?: Record<'low' | 'mid' | 'high', number>;
  mix?: Mix;                                 // 저장 순간의 레이어 믹스 (선택)
};
// Extras에 motifs: Motif[] 추가, defaultExtras()에 motifs: []
```
- **관절 좌표·영상은 저장하지 않는다** (원칙 3). 숫자 집계만.
- `validation.ts`: `e.motifs`가 없으면 `[]`. 있으면 각 항목 검사(`ids.has(projectId)`, `start < end`, `body`는 `validTracking`과 같은 방식으로 6개 키·유한수). 최대 1000개.
- `LibraryProvider.tsx`: 프로젝트 삭제 시 해당 `motifs`도 삭제, 백업 병합(`merge`) 시 id 기준 합치기 — 기존 `motions` 처리와 똑같이.

**저장 버튼 위치**:
- Session 카메라 탭: 히트맵 옆 [이 8카운트 저장]. 현재 8카운트 범위는 `countInEight`/`eightKey`(`src/tracking/windows.ts`)와 `PlayerScreen`의 `analysis.eights`로 구한다. 재생 중 누르면 **방금 끝난 8카운트**가 아니라 **지금 진행 중인 8카운트**를 저장 (`body`는 그 시점까지의 집계).
- Session 믹서 탭 "박자 · 구간 보기"의 [이 구간 반복] 옆에도 같은 버튼 (카메라 없이 음악 구간만 저장 → `body` 없음).
- 저장하면 토스트 대신 버튼 문구가 2초간 "저장했어요 ✓"로 바뀐다.

**Workspace > Saved** (`app/workspace.tsx` 탭 `saved`):
- 섹션 1 "저장한 모티프": 최신순. 카드 = 이름, 곡, 시간 범위, `body`가 있으면 `BodyHeatmap` 미니(높이 120), [이 구간 연습하기] → 해당 프로젝트로 세션 시작 + `loop: { start, end }`로 반복 설정 (세션 시작 시 `initialSnapshot.loop`를 쓰는 기존 경로 재사용), [이름 변경], [삭제].
- 섹션 2 "저장한 프로젝트": 기존 내용.

**테스트**: `scripts/test-library.cjs`에 motifs 왕복(저장→검증→복원)과 잘못된 motif 거부 케이스 추가.

---

### 작업 5. Home > Insights Preview · Recommendation (2단계)
- Insights Preview: 기존 숫자 카드 2개 아래에 `BodyHeatmap` 미니(높이 140, 기록 있을 때만) + "자세히" → `/analysis`.
- Recommendation: `trackingInsights(...).unexplored[0]`이 있으면 "최근 {N}개 세션에서 {왼다리}는 아직 조용했어요. 다음엔 한번 써볼까요?" + [연습 시작]. 문구는 `src/tracking/phrases.ts` 톤(관찰 + 열린 제안, 명령형 금지). 기록이 없으면 섹션 숨김.

### 작업 6. Analysis 출처 정리 · 움직임 스튜디오 위치 (2단계, **결정 필요**)
- 현재 "동일 패턴 반복"과 "Space"에 카메라 기록 카드와 움직임 스튜디오 카드가 섞여 있다. 각 섹션에서 **카메라 기록 카드를 위, 스튜디오 카드를 아래**로 두고 출처 pill을 통일 ("카메라 기록" / "영상·좌표 분석").
- 움직임 스튜디오(`/motion`)는 IA 노드가 없다. 선택지:
  - (a) Analysis 상단 "영상으로 분석하기" 버튼으로만 진입 (현재 `analysis.tsx`의 "동작 분석 스튜디오 열기" 버튼 유지, `project.tsx`의 진입 버튼 제거)
  - (b) 기능 삭제
  - 기본값: (a). 팀 결정 전에는 (a)로 진행.
- 참고: "동일 패턴 반복"의 반복 주기 추정은 현재 스튜디오(`analyzeTrace`의 peaks/period)에만 있고, 카메라 트래킹(`moves.ts`)은 동작 **횟수**만 센다. 카메라 기록으로 반복 주기를 보려면 `moves.ts`에 별도 작업이 필요하다 (이번 범위 아님).

### 작업 7. Workspace > Compose (2단계, **설계 결정 필요**)
- MVP 제안: 한 프로젝트(곡) 안의 모티프들을 세로 리스트로 순서 배치 → [이어서 재생]은 각 모티프 구간을 순서대로 반복 재생. 다른 곡의 모티프는 섞지 않는다.
- 데이터: `Composition = { id, projectId, name, motifIds: string[], createdAt }`를 `extras.compositions`에 추가 (작업 4와 같은 검증 패턴).
- 진입: Workspace > Saved의 모티프 섹션 상단 [구성하기], 또는 project 화면.
- 팀과 정할 것: 곡 전체 타임라인 위에 배치(8카운트 칸) vs 순서 리스트. 흐름도의 "Review ↔ Compose" 왕복을 어디서 할지.

### 작업 8. Mission > Monthly · Explore (2단계)
- Monthly: `missionProgress`(`state/model.ts`)를 월 단위로 일반화 (`monthKey()` 추가). 목표는 주간 목표 × 4 기본.
- Explore: 하단 탭 Mission 화면의 `[이번 주 미션 | 나의 피드]` 스위치를 `[주간 | 월간 | Explore]`로 바꾸고, Explore에 현재 `community.tsx` 내용을 임베드. `/community` 라우트는 유지(딥링크용).

---

## 4. 참고: 재사용할 코드 위치

| 필요한 것 | 위치 |
|---|---|
| 부위 비율 → 퍼센트(합 100), 색 농도, 최다/최소 부위 | `src/tracking/bodyMap.ts` (`wholePercents`, `heatStrength`, `extremes`, `fromSegments`, `fromStudio`) |
| 몸 히트맵 컴포넌트 | `src/components/tracking/BodyHeatmap.tsx` (`shares`, `underused`, `dim`) |
| 세션 여러 개의 부위·높이 합산, 자주 안 가본 쪽 | `src/tracking/insights.ts` (`trackingInsights`, `moveInsights`) |
| 실시간 트래킹 상태 (부위 비율·높이·상태·제안) | `src/tracking/store.ts` `LiveTrackingStore.getView()` |
| 8카운트 창 계산 | `src/tracking/windows.ts` (`planFor`, `eightKey`, `countInEight`) |
| 부위 이름 한국어 | `src/tracking/phrases.ts` (`SEGMENT_LABELS`, `LEVEL_NAMES`, `label`) |
| 세션 저장/이어하기 | `src/state/LibraryProvider.tsx` (`start`, `checkpoint`), `src/state/model.ts` (`PlaybackSnapshot`, `Session`) |
| 저장 데이터 검증 | `src/state/validation.ts` |
| 공용 UI | `src/ui/Kit.tsx` (`Page`, `Card`, `Button`, `Section`, `Empty`, `Heading`, `ui`) |

## 5. 하지 말 것
- Analysis·Home·Workspace에서 카메라를 켜는 UI를 만들지 않는다.
- 부위 비율에 점수·등급·"좋음/나쁨"·빨간색을 붙이지 않는다. 조용한 부위는 점선 테두리 + "안 가본 쪽".
- 관절 좌표 배열이나 영상을 세션/모티프에 저장하지 않는다.
- `src/tracking/config.ts`에서 id403과 공유하는 섹션(`pose`, `smoothing`, `calibration`, `features`, `aggregate`, `perf`, `feedback`) 값을 바꾸지 않는다 (정답 테스트가 깨진다). 앱 전용 값은 `app` 섹션에 추가.
- `npm audit fix --force` 실행 금지 (Expo SDK 버전이 깨진다).
- 네이티브 모듈(`modules/*/android`)은 이번 범위에서 수정하지 않는다.
