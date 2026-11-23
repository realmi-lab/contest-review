import { seoulMinute } from "../../public/html.mjs";

export const defaults = {
  categories: [
    "복지·근무환경",
    "시설·비품·공간",
    "조직문화·교류",
    "인사·교육",
    "업무방식·협업",
    "고객경험·서비스",
    "사업·마케팅·사회공헌",
    "거래·입출금·지갑",
    "보안·이용자 보호",
    "기타·복합 제안",
  ],
  // 사내 아이디어 제안 채널(가상자산 거래소)의 1차 심사 기준.
  // 판단 기준의 첫 문장은 채점표에 늘 보이는 한 줄 정의이고, 뒤의 높음·낮음 보기는 펼쳤을 때 보인다.
  criteria: [
    {
      name: "문제 정의",
      weight: 1.5,
      guide:
        "누가 어떤 상황에서 얼마나 자주 겪는 문제인가. 높음: 대상(직원·부서·고객)과 상황, 불편·위험·비효율이 구체적이다. 낮음: 누구의 문제인지 흐리다. 작은 불편도 대상과 상황이 분명하면 충분하다.",
    },
    {
      name: "효과 크기",
      weight: 2.5,
      guide:
        "영향받는 사람이 얼마나 많고 얼마나 나아지며 실제로 쓰일 것인가. 높음: 대상이 넓거나 개선 폭이 뚜렷하고 쓰기 쉽다. 낮음: 쓰는 사람이 적고 달라지는 점이 작다. 복지·시설·문화는 이용 인원·만족·형평성, 업무방식은 절감 시간·오류 감소·적용 부서, 고객·사업은 고객 편의·이용 증가·비용 대비 효과, 거래·보안은 사고 예방·민원 감소·신뢰를 본다.",
    },
    {
      name: "실행 가능성",
      weight: 2.5,
      guide:
        "규모에 맞는 담당·비용·기간·관리 방법이 보이는가. 높음: 지금 자원으로 시작할 방법이 보인다. 낮음: 누가 무엇을 해야 하는지 알 수 없다. 시스템 제안은 변경 범위를 보고, 소규모 제안은 간단한 운영 방식으로 충분하다.",
    },
    {
      name: "근거",
      weight: 2,
      guide:
        "문제와 효과를 뒷받침하는 자료가 있는가. 높음: 직접 확인한 수치나 사례가 있다. 낮음: 주장만 있다. 간단한 관찰·설문도 근거가 된다.",
    },
    {
      name: "차별성",
      weight: 1.5,
      guide:
        "지금 방식에 무엇이 새로 더해지는가. 높음: 현재 방식으로 풀리지 않던 점을 푼다. 낮음: 이미 하고 있는 일과 다르지 않다. 익숙한 아이디어도 현장 문제에 잘 맞으면 높은 점수가 가능하고, 업계 최초일 필요는 없다.",
    },
  ],
};
// 점수와 따로 남기는 1차 심사 표시. 화면과 서버가 같은 목록을 쓴다(/api/state의 sheet).
// checks는 감점이 아니라 담당 부서가 확인할 일로 넘기는 표시다.
export const sheet = {
  checks: ["규제 검토", "보안·고객 자산 검토", "시스템 안정성 검토", "중복·기시행 확인"],
  scales: ["즉시 실행", "과제화", "장기 검토"],
  decisions: ["채택 검토", "보완 요청", "보류"],
  // 채택 검토로 확정한 뒤의 실행 추적 단계
  stages: ["부서 검토", "실행 중", "효과 확인", "실행 안 함"],
};
const fail = (message) => {
  throw new Error(message);
};
const tenths = (n) => Math.abs(n * 10 - Math.round(n * 10)) <= 1e-6; // 0.1점 단위인가
// 심사자가 낸 채점표를 확인해 저장할 모양으로 돌려준다. 확정 점수(score)는 항목 점수의 합이다.
export function finalSheet(value, spec) {
  const scores = value?.scores;
  if (
    !Array.isArray(scores) ||
    scores.length !== spec.criteria.length ||
    scores.some((n, i) => !Number.isFinite(n) || n < 0 || n > spec.criteria[i].weight || !tenths(n))
  )
    fail("항목마다 0점부터 배점까지 0.1점 단위로 입력하세요.");
  if (!sheet.scales.includes(value.scale) || !sheet.decisions.includes(value.decision))
    fail("실행 규모와 1차 결정을 선택하세요.");
  const text = (x, max) => String(x ?? "").trim().slice(0, max);
  const by = text(value.by, 40);
  if (!by) fail("평가자 이름을 입력하세요.");
  return {
    score: scores.reduce((sum, n) => sum + Math.round(n * 10), 0) / 10, // 0.1점 단위로 더해 소수 오차를 없앤다
    scores,
    checks: sheet.checks.filter((c) => value.checks?.includes(c)),
    scale: value.scale,
    decision: value.decision,
    department: text(value.department, 80),
    feedback: text(value.feedback, 1000),
    note: text(value.note, 2000),
    by,
  };
}

// 심사자 평가표(MS Forms 연동)에서 모은 점수: 다 채운 평가의 평균
export function evaluationSummary(w) {
  const entries = Object.values(w.evaluations ?? {}).filter(Boolean);
  const done = entries.filter((e) => e.complete);
  const average = done.length ? Math.round((done.reduce((sum, e) => sum + e.score, 0) / done.length) * 100) / 100 : null;
  return { entries, done: done.length, average };
}

// 채택 뒤 실행 추적: 단계·담당 부서·담당자·예정일·효과. 단계가 바뀌면 언제 바뀌었는지 history에 남긴다.
export function followupSheet(value, previous) {
  if (!sheet.stages.includes(value?.stage)) fail("실행 단계를 고르세요.");
  const due = String(value.due ?? "").trim();
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) fail("예정일을 확인하세요.");
  const text = (x, max) => String(x ?? "").trim().slice(0, max);
  const now = new Date().toISOString();
  const history = previous?.stage === value.stage ? previous.history : [...(previous?.history ?? []), { stage: value.stage, at: now }];
  return { stage: value.stage, department: text(value.department, 80), owner: text(value.owner, 40), due, effect: text(value.effect, 2000), updated: now, history };
}

// 멈춘 실행: 아직 진행 중인 단계인데 예정일이 지났거나 30일 넘게 바뀐 게 없다
export function stalled(followup, today) {
  if (!followup || !["부서 검토", "실행 중"].includes(followup.stage)) return false;
  const quiet = Date.parse(today) - Date.parse(followup.updated.slice(0, 10)) > 30 * 86400000;
  return (!!followup.due && followup.due < today) || quiet;
}

// 전체 작품의 채점 결과 표(첫 줄은 머리글). 확정 점수 순, 그다음 심사자 평균 순이고 채점 전 작품은 '미채점'으로 둔다.
// 작품마다 기준이 다를 수 있어 항목 점수는 기준 이름으로 열을 맞춘다.
export function scoreRows(works, criteria) {
  const names = [...new Set([...criteria, ...works.flatMap((w) => w.rubric?.criteria ?? [])].map((c) => c.name))];
  const head = ["작품명", "분야", "인입일", "팀", "접수자", ...names, "총점", "실행 규모", "1차 결정",
    "사전 확인", "이관 부서", "제안자 의견", "심사 메모", "평가자", "확정 시각", "심사자 평가 수", "심사자 평균", "심사자별 총점",
    "실행 단계", "실행 담당 부서", "실행 담당자", "실행 예정일", "실행 효과"];
  const rank = (w) => [w.final?.score ?? -1, evaluationSummary(w).average ?? -1];
  const ranked = [...works].sort((a, b) => rank(b)[0] - rank(a)[0] || rank(b)[1] - rank(a)[1]);
  return [head, ...ranked.map((w) => {
    const f = w.final;
    const scoreOf = (name) => f?.scores[w.rubric.criteria.findIndex((c) => c.name === name)] ?? "";
    const { entries, done, average } = evaluationSummary(w);
    return [w.name, w.category ?? "", w.receivedOn ?? "", w.intakeTeam ?? "", w.submitterName ?? "", ...names.map(scoreOf),
      f?.score ?? "", f?.scale ?? "", f?.decision ?? "미채점", f?.checks.join(" · ") ?? "", f?.department ?? "",
      f?.feedback ?? "", f?.note ?? "", f?.by ?? "", f ? seoulMinute(f.when) : "",
      entries.length ? done : "", average ?? "", entries.map((e) => `${e.name} ${e.complete ? e.score : "작성 중"}`).join(" · "),
      w.followup?.stage ?? "", w.followup?.department ?? "", w.followup?.owner ?? "", w.followup?.due ?? "", w.followup?.effect ?? ""];
  })];
}

// 엑셀이 한글을 바로 읽도록 BOM을 붙인다. =·+·-·@로 시작하는 글자 칸은 수식으로 실행되지 않게 작은따옴표를 앞에 둔다.
export function toCsv(rows) {
  const cell = (v) => {
    const s = typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
export function rubric(value) {
  if (!Array.isArray(value?.categories) || !Array.isArray(value?.criteria))
    fail("분야와 심사 기준을 확인하세요.");
  const categories = [
    ...new Set(value.categories.map((x) => String(x).trim()).filter(Boolean)),
  ];
  if (
    !categories.length ||
    categories.length > 25 ||
    categories.some((c) => c.length > 60)
  )
    fail("분야를 1~25개로 설정하세요.");
  const criteria = value.criteria.map((x) => ({
    name: String(x.name ?? "").trim(),
    guide: String(x.guide ?? "").trim(),
    weight: x.weight,
  }));
  if (
    !criteria.length ||
    criteria.length > 10 ||
    new Set(criteria.map((x) => x.name)).size !== criteria.length ||
    criteria.some(
      (x) =>
        !x.name ||
        x.name.length > 50 ||
        !x.guide ||
        x.guide.length > 500 ||
        !Number.isFinite(x.weight) ||
        x.weight <= 0 ||
        !tenths(x.weight),
    ) ||
    Math.abs(criteria.reduce((n, x) => n + x.weight, 0) - 10) > 1e-6
  )
    fail(
      "기준 이름은 고유해야 하며, 배점은 0.1점 단위로 합계 10점이어야 합니다.",
    );
  return { categories, criteria };
}
export function coverage(captures) {
  const problems = [],
    docs = new Map();
  for (const c of captures) {
    if (c.issue) problems.push(c.label + " · " + c.issue);
    if (c.status !== "ready" || (!c.lines.length && !c.visual))
      problems.push(c.label + " · 판독 가능한 자료 필요");
    if (c.total || c.page) {
      const d = docs.get(c.document) ?? { totals: new Set(), pages: new Set() };
      if (c.total) d.totals.add(c.total);
      if (c.page) d.pages.add(c.page);
      docs.set(c.document, d);
    }
  }
  for (const [name, d] of docs) {
    if (d.totals.size > 1) {
      problems.push(name + " · 전체 쪽수 불일치");
      continue;
    }
    const [total] = d.totals;
    if (total) {
      const missing = Array.from({ length: total }, (_, i) => i + 1).filter(
        (n) => !d.pages.has(n),
      );
      if (missing.length)
        problems.push(name + " · 누락된 쪽 " + missing.join(", "));
      if ([...d.pages].some((n) => n > total))
        problems.push(name + " · 전체 쪽수를 넘는 캡처");
    }
  }
  return problems;
}
