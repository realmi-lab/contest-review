// Short proposals often have several summaries of a single source list. Keep
// the listed steps together so one list cannot consume the entire first screen.
function sourceLists(points, evidence) {
  const aliases = new Map();
  let run = [];
  function finish() {
    if (run.length > 1) {
      const text = [...new Set(run.map((p) => p.text))].join(" ");
      const combined = { ...run[0], text };
      for (const p of run) aliases.set(p, combined);
    }
    run = [];
  }
  for (const p of points) {
    const ref = p.refs?.length === 1 && p.refs[0];
    const raw = evidence[ref]?.text || "";
    if (
      !ref ||
      p.mode !== "요약" ||
      (raw.match(/(?:^|\s)[•·●▪]|[①-⑳]/gu) || []).length < 2
    ) {
      finish();
      continue;
    }
    if (
      run.length &&
      (run[0].refs[0] !== ref ||
        run[0].sourceNote !== p.sourceNote ||
        [...run, p].map((v) => v.text).join(" ").length > 270)
    )
      finish();
    run.push(p);
  }
  finish();
  return aliases;
}

const saidBy =
  /(?:제출한|제안한|건의한)\s*['"‘“]?[^.]{0,90}(?:요청서|제안서|건의서)/u;
const concreteRequest =
  /(?:도입|개발|공표|설치|보완|마련|병행|확대|신설|운영|지원|시행|재배치|개선|적용|분석).{0,55}(?:제안|검토|요청|건의|해야|하여야|수행)|(?:도입|마련|제도화|병행|신설|시행)[.。]?$/u;
const expectation =
  /기대\s*효과|기대(?:된|할|합|함)|예상(?:된|한|합|함)|(?:된다면|다면|할 경우).{0,100}(?:도움|높아|향상|낮아|줄어|감소)|도움이\s*될|정착\s*가능/u;
const observed =
  /(?:응답|실험|측정|설문|조사|검증|시범\s*운영).{0,28}(?:결과|명\s*중|나타났|확인됐|확인되었)|(?:응답자|대상자)\s*\d+\s*명/u;
const validationPlan =
  /(?:설문|시험|측정|검증|평가|조사).{0,28}(?:예정|계획|실시할|확인할)/u;
const pilot =
  /(?:시범|파일럿|시험)\s*(?:적용|운영|사업|도입|실시|시행|적으로|기간)/u;
const boundary =
  /(?:경우에만|조건에서만|무관하게|관계없이|제외하고|대상에서\s*제외|(?:그대로|현행대로)\s*유지|전용으로|시에만|때에만|일회성|단발성)/u;
const alternatives =
  /(?:설치|운영|지급|연장|중단|반환|회수|승인|지원|배치|도입|등록|유지|해지|변경|추가)\s*(?:또는|혹은)\s*\S+/u;
const alternativeAccess =
  /(?:에서도|으로도|로도|경우에도).{0,32}(?:가능|이용|접수|신청|허용)/u;
const eligibility =
  /(?:자격|본인|신분|신원|회원|대상자).{0,22}(?:확인|검증|인증|심사)|(?:확인|검증|인증|심사).{0,22}(?:한정|만\s*(?:이용|신청|가입|참여|모여)|대상자)|(?:자격|신청|이용|지원|참여)\s*대상.{0,32}(?:한정|제한|한해|자격)/u;
const cost = /\d[\d,.\s]*(?:억|천만|백만|십만|만|천|백)?\s*원/u;
const budgetContext =
  /사업비|예산|소요\s*(?:액|비용)|지출\s*한도|단가|총액|비용|경비/u;
const itemCount =
  /\d[\d,.\s]*(?:개소|개(?!월)|곳|명|세트|종|대(?!상|비)|건|실|부|매|좌석|장|벌|권|팩|상자|가구|세대)/u;
const scaleContext =
  /(?:선정|설치|배치|설비|비치|배정|모집|조달|구매|배포|도입|공급|지원|접수|규모|물량|수량|정원|인원|인당|종류별|항목별|유형별|용도별)/u;
const breakdown =
  /\d[\d,.]*\s*(개소|개|곳|명|세트|종|대|건|실|부|매|좌석|장|벌|권|팩|상자|가구|세대)(?!월)[^.!?]{1,35}?\d[\d,.]*\s*\1(?!월)/u;
const baselineGap =
  /(?:차이|격차|괴리).{0,35}(?:반영되지|발생|벌어|커지|줄이지)|과(?:소|대)\s*(?:평가|대표)|(?:충분히|제대로)\s*반영되지/u;
const quantified =
  /\d[\d.,~～×x\s-]*(?:[%°℃]|분기|개월|개소|시간|년|월|일|주|분|초|명|원|개|회|[kcm]?m\b).{0,28}(?:이상|이하|이내|초과|미만|전에|마다|이후|한도|주기|단위|접근|이수|기준)/iu;
const method =
  /구성\s*요소|작동\s*(?:조건|흐름|원리)|운영\s*(?:절차|방식)|(?:이용|신청|처리)\s*절차|중첩\s*분석|(?:을|를)\s*활용(?:한|하여|해).{0,45}(?:산출|도출|분석)|(?:초과|미달).{0,65}(?:안내|통지|설명)|평가\s*기반/u;
const background = /현재|현행|기존|부족|부담|불편|어려[움워운]|우려|소외|단절/u;
const broadContext =
  /공통적으로\s*느끼|어려운\s*부분이\s*있|필요성이\s*제기|많은\s*(?:분|사람)들이?\s*(?:느끼|겪)/u;
const genericClose =
  /^(?:현장의?\s*필요를?\s*반영하여\s*)?(?:적극적인?\s*)?검토(?:해|하여)?\s*(?:달라|주실|주십|부탁)/u;

function key(text) {
  return text
    .normalize("NFKC")
    .replace(/\s/gu, "")
    .replace(/[.。!?]+$/u, "");
}

function isProposal(points, evidence) {
  const title = Object.values(evidence)[0]?.text?.replace(/\s/gu, "") || "";
  if (
    /보고서|논문|조사결과|연구결과|실험결과|통계(?:자료|표)|현황(?:보고|조사|분석)|(?:현황|실적)$|report|surveyresults/iu.test(
      title,
    )
  )
    return false;
  return (
    /제안|건의|요청|(?:만들어|해)주세.?요|(?:도입|개선|확대|설치)(?:방안)?[.。]?$/u.test(
      title,
    ) ||
    points.some((p) =>
      /제안(?:서|합니다|드립니다|하고자|함)|건의(?:한|합니다|드립니다|함)|요청(?:서|합니다|드립니다|함)/u.test(
        p.text,
      ),
    )
  );
}

const eligibilityLabels = {
  current: "현행 자격",
  proposed: "제안한 자격",
  preference: "우대 기준",
  quota: "선발 규모",
};

function eligibilityBrief(lead, points, evidence) {
  const facts = points.filter(
    (p) =>
      p.mode === "자격·선발 원문" &&
      Object.hasOwn(eligibilityLabels, p.eligibilityRole) &&
      p.text &&
      p.refs?.length &&
      p.refs.every((id) => evidence[id]?.text),
  );
  if (!facts.length) return null;
  const sourceRefs = new Set(facts.flatMap((p) => p.refs));
  const ordinary = [...lead, ...points].filter(
    (p) =>
      p.mode !== "자격·선발 원문" &&
      p.refs?.length &&
      p.text &&
      !p.refs.some((id) => sourceRefs.has(id)) &&
      !genericClose.test(p.text),
  );
  const title = Object.entries(evidence)[0];
  const titleText = title?.[1]?.text?.trim() || "";
  const usableTitle =
    titleText.length >= 12 &&
    titleText.length <= 135 &&
    /제안|요청|개편|개선|지원\s*확대|대상\s*확대|조건\s*완화|요건\s*(?:변경|폐지)|제도\s*도입/u.test(
      titleText,
    );
  const head = usableTitle
    ? {
        text: titleText,
        refs: [title[0]],
        mode: "원문 발췌",
        topic: "제안 내용",
      }
    : ordinary.find(
        (p) => concreteRequest.test(p.text) && !expectation.test(p.text),
      ) ||
      ordinary.find((p) => p.topic === "제안 내용") ||
      points.find(
        (p) =>
          p.mode !== "자격·선발 원문" &&
          p.topic === "제안 내용" &&
          !/\d/u.test(p.text) &&
          concreteRequest.test(p.text) &&
          p.refs?.length,
      );
  const chosen = head ? [head] : [];
  const signature = (p) => (p.eligibilityRole || "") + "/" + key(p.text);
  const unique = new Set(chosen.map(signature));
  function add(p) {
    if (!p || chosen.length >= 6 || unique.has(signature(p))) return;
    unique.add(signature(p));
    const label =
      p.mode === "자격·선발 원문" && eligibilityLabels[p.eligibilityRole];
    chosen.push(
      label && !p.sourceNote?.includes(label)
        ? {
            ...p,
            sourceNote: [label, p.sourceNote].filter(Boolean).join(" · "),
          }
        : p,
    );
  }
  // Reserve a slot per observed role before taking further conditions within
  // any role. A proposed rule and a current rule may cite the same paragraph.
  for (const role of Object.keys(eligibilityLabels))
    add(facts.find((p) => p.eligibilityRole === role));
  for (const p of facts) add(p);
  for (const p of ordinary) {
    if (p !== head && p.refs.some((id) => head?.refs.includes(id))) continue;
    if (
      concreteRequest.test(p.text) ||
      observed.test(p.text) ||
      validationPlan.test(p.text)
    )
      add(p);
  }
  return chosen;
}

// All candidates are existing, grounded statements. The original lead is the
// tie breaker within each role. Branches with their own editor keep its choices.
export function selectProposalBrief(
  lead,
  points,
  evidence,
  originalPointCount = points.length,
) {
  const compared = eligibilityBrief(lead, points, evidence);
  if (compared) return compared;
  if (
    !points.length ||
    originalPointCount >= 16 ||
    points.some((p) => p.mode?.startsWith("표의 ")) ||
    !isProposal(points, evidence)
  )
    return lead;
  const aliases = sourceLists(points, evidence);
  const byText = new Map(points.map((p) => [p.text, p]));
  const candidates = [
    ...new Set(
      [...lead, ...points].map((p) => {
        const point = byText.get(p.text) || p;
        return aliases.get(point) || point;
      }),
    ),
  ].filter((p) => p.refs?.length && p.text && !genericClose.test(p.text));
  if (
    !candidates.some((p) => concreteRequest.test(p.text) || pilot.test(p.text))
  )
    return lead;
  const chosen = [];
  const selected = new Set();
  function add(p) {
    if (!p || chosen.length === 6 || selected.has(key(p.text))) return;
    selected.add(key(p.text));
    chosen.push(p);
  }
  function pick(test) {
    if (!chosen.some(test)) add(candidates.find(test));
  }
  const request = (p) =>
    concreteRequest.test(p.text) && !expectation.test(p.text);
  const head =
    candidates.find((p) => saidBy.test(p.text)) ||
    candidates.find(request) ||
    candidates[0];
  add(head);
  if (!request(head)) pick(request);
  const hasBudget = (p) => cost.test(p.text) && budgetContext.test(p.text);
  const hasScale = (p) =>
    itemCount.test(p.text) &&
    (scaleContext.test(p.text) || breakdown.test(p.text));
  pick(hasBudget);
  // A per-unit allocation can also name the number of participating sites. If
  // separate statements describe the site count and the allocation, keep both.
  const distribution = (p) =>
    hasScale(p) &&
    (breakdown.test(p.text) ||
      /(?:당|각각|종류별|항목별|유형별|용도별|씩).{0,24}\d|\d.{0,12}씩/u.test(
        p.text,
      ));
  pick(distribution);
  pick((p) => hasScale(p) && /(?:선정|모집|총\s*\d|규모|정원)/u.test(p.text));
  pick(hasScale);
  pick((p) => eligibility.test(p.text));
  pick((p) => method.test(p.text));
  pick((p) => quantified.test(p.text));
  pick((p) => boundary.test(p.text));
  pick((p) => alternatives.test(p.text));
  pick((p) => alternativeAccess.test(p.text));
  // A broad request for a pilot and a later description of its bounded scope
  // can coexist. Prefer the explicit scope before accepting the broad mention.
  const scopedPilot = (p) =>
    pilot.test(p.text) &&
    /(?:작은|좁은|제한된|일부|우선|소규모|한정|\d+\s*(?:명|곳|개|주|개월))/.test(
      p.text,
    );
  pick(candidates.some(scopedPilot) ? scopedPilot : (p) => pilot.test(p.text));
  pick(
    (p) =>
      observed.test(p.text) &&
      !expectation.test(p.text) &&
      !validationPlan.test(p.text),
  );
  pick((p) => validationPlan.test(p.text));
  pick((p) => baselineGap.test(p.text));
  pick((p) => expectation.test(p.text));
  pick((p) => background.test(p.text) && !expectation.test(p.text));
  // Fill remaining slots in the model's order. In a short proposal the
  // remaining distinct requests may also be phrased as anticipated benefits.
  for (const p of candidates.filter(
    (p) => concreteRequest.test(p.text) || expectation.test(p.text),
  ))
    add(p);
  for (const p of candidates) {
    const contextAlreadyShown =
      p.topic === "대상과 배경" &&
      chosen.some((q) => q.topic === p.topic && !concreteRequest.test(q.text));
    if (
      contextAlreadyShown &&
      broadContext.test(p.text) &&
      !/\d|제외|예외|않|못|불가/u.test(p.text)
    )
      continue;
    add(p);
  }
  return chosen;
}
