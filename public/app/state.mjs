// 화면 상수와 화면 상태. 여러 모듈이 함께 읽고 바꾸는 값은 state 하나에 모아 state.work처럼 쓴다.
/* ─────────────────────────── 상수 ─────────────────────────── */

export const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
export const DEFAULT_FIELDS = { document: "제안서" };
export const STEP_TABS = {
  자료: "캡처 자료",
  요약: "AI 요약",
  점검: "AI 논리점검",
  결과: "채점표",
};
export const LINK_TABS = { report: "결과", summary: "요약", logic: "점검" }; // ?tab=
export const POLL_BUSY_MS = 1500; // 진행 중인 작업이 있을 때
export const POLL_IDLE_MS = 4000;

/* ─────────────────────────── 화면 상태 ─────────────────────────── */

export const state = {
  app: null, // /api/state: 작품 목록, 진행 작업, 글자 인식 준비 상태
  jobsByWork: new Map(), // 작품 id → { label, running }
  work: null, // 선택한 작품의 전체 데이터
  selected: "", // 선택한 작품 id (처음 값은 navigation.mjs가 주소·지난번 선택에서 읽는다)
  tab: "자료", // 작품 화면의 단계
  viewer: null, // 오른쪽 원문 패널: { captureId, evidence, ref, snapshot }
  docFields: { ...DEFAULT_FIELDS }, // 캡처 추가 입력값 (다시 그려도 유지)
  shownWork: "", // 화면에 그려진 작품 id
  shownKey: "", // 화면에 그려진 작품 id + 수정 시각
  editingSheet: false, // 확정한 채점표를 고치는 중
  stampNext: false, // 방금 확정했으면 도장 찍히는 움직임을 한 번 보여 준다
  unsavedForm: false, // 저장하지 않은 폼 입력이 있으면 자동 갱신을 멈춤
  listQuery: { text: "", view: "all", sort: "todo" }, // 목록 화면 검색·표 위의 탭(all·summary·check·sheet)·정렬
  uploading: false, // 캡처를 올리는 중
  stream: null, // 문서 창 공유
  watchTimer: undefined, // 문서 창 공유 중 화면 변화 감시
};

// 요약을 대기열에 넣는 중인 작품 id
export const submittingSummaries = new Set();

// AI 연결(요약 설정에서 정한 모델·연결 주소): 요약과 AI 논리점검은 이 모델로만 만든다
export const aiLabel = () => state.app?.ai?.label || "Haiku 5.5";
export const summaryModel = () => "AI · " + aiLabel();
export const cloudScope = () =>
  `AI 요약과 AI 논리점검은 ${state.app?.ai?.provider === "litellm" ? "회사 LiteLLM(Bedrock)" : "Anthropic API"}를 사용합니다. OCR 텍스트와 ‘도식 검토’를 선택한 캡처 이미지를 전송합니다.`;
