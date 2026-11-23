// 같은 이름의 지표를 서로 다르게 정의한 곳(뺄셈의 순서)을 찾는다. 업무상 의미나 양수·음수 예시,
// 결과로 부호를 추측하지 않고 원문에 적힌 정의만 비교한다.
const word = "[가-힣A-Za-z][가-힣A-Za-z0-9_]{0,23}";
const notation = new RegExp(
  `(?<![가-힣A-Za-z0-9_])(${word})\\s*[(（]\\s*(${word})\\s*[-−]\\s*(${word})(?:\\s+차이)?\\s*[)）]`,
  "gu",
);
const definition = new RegExp(
  `(?<![가-힣A-Za-z0-9_])(${word}?)(?:이란|란)\\s+([^.!?。;:()（）\\n]{1,90}?)에서\\s*([^.!?。;:()（）\\n]{1,60}?)(?:을|를)\\s*뺀\\s*값`,
  "gu",
);
const scopeWord =
  /(?:향후|직전|지난|이전|다음|최근)?\s*\d{1,4}\s*(?:개월|시간|분기|주일|년도|년|월|주|일|분)|작년|올해|내년|전년|금년|당기|전기|지난달|이번달|다음달|금월|전월|당월|월별|연간|월간|주간|일간/g;
const clean = (s) => s.replace(/\s+/g, "");

// 한 문단이 다른 주장의 근거일 수도 있다. 다툼이 있는 정의를 되풀이하면서 그 정의를 쓴 구절을
// 인용한 문장에만 표시한다.
export function markDisputedDefinition(point, alerts) {
  const normalize = (s) => clean(s.normalize("NFKC")).replace(/[−–]/g, "-");
  const text = normalize(point.text);
  const label = "원문에서 계산 방향이 엇갈림";
  const repeatsDefinition = alerts?.some(
    (alert) =>
      alert.method === "명시된 뺄셈 정의 대조" &&
      [alert.claim, alert.contrast].some(
        (side) =>
          side?.quote &&
          point.refs.includes(side.id) &&
          text.includes(normalize(side.quote)),
      ),
  );
  const notes = point.sourceNote?.split(" · ") || [];
  if (notes.includes(label) === Boolean(repeatsDefinition)) return point;
  const { sourceNote, ...rest } = point;
  const remaining = notes.filter((note) => note !== label);
  if (repeatsDefinition) remaining.push(label);
  return remaining.length
    ? { ...rest, sourceNote: remaining.join(" · ") }
    : rest;
}

function context(text, match) {
  const preceding = text.slice(0, match.index).split(/[.!?。;\n]/);
  const before = preceding.at(-1);
  let scope = before + match[0];
  if (/해당\s*(?:시간|기간)|같은\s*(?:시간|기간)/.test(match[0]))
    scope = (preceding.at(-2) || "") + scope;
  const periods = [
    ...new Set([...scope.matchAll(scopeWord)].map((m) => clean(m[0]))),
  ].sort();
  // 이름 앞의 낱말이 그 이름을 한정할 수 있다("영업 이익"). 한쪽 정의에만 있는 한정어는
  // 다른 쪽 정의에도 있어야 같은 지표로 본다.
  const previous = before.trimEnd().match(/([가-힣A-Za-z0-9_]+)$/)?.[1] || "";
  const qualifier = /(?:은|는|을|를|의|에서|별|대한|대해)$/.test(previous)
    ? ""
    : previous;
  return { periods: periods.join("|"), qualifier };
}

function compatible(a, b) {
  return (
    a.metric === b.metric &&
    a.periods === b.periods &&
    (!a.doc || !b.doc || a.doc === b.doc) &&
    (!a.qualifier ||
      a.qualifier === b.qualifier ||
      b.quote.includes(a.qualifier)) &&
    (!b.qualifier ||
      a.qualifier === b.qualifier ||
      a.quote.includes(b.qualifier))
  );
}

// 구절은 그 피연산자 이름, 개수 단위, 또는 같은 대상의 개수("반납된 자전거 대수",
// "대여되어 나간 자전거 대수")로 끝나야 한다. 끝까지 맞춰 봐야 "대여소"를 피연산자 "대여"로 잘못 보지 않는다.
function quantity(phrase, operand) {
  if (
    /[+*/×÷−-]|제외|차감|제하고|뺀|곱한|더한|나눈|아닌|초과|미만|이상|이하|합산|또는|및|(?:과|와)\s/.test(
      phrase,
    )
  )
    return null;
  const term = [...operand].join("\\s*");
  const mentions = [...phrase.matchAll(new RegExp(`(?:^|\\s)${term}`, "gu"))];
  if (mentions.length !== 1) return null;
  const match = mentions[0];
  const prefix = phrase.slice(0, match.index).trim();
  const tail = phrase.slice(match.index + match[0].length).trim();
  const unit = "(?:대수|개수|수량|금액|건수|횟수|인원|인원수|총액|합계|수)";
  if (!tail || new RegExp("^" + unit + "$").test(tail))
    return { prefix, unit: tail };
  const counted = tail.match(
    new RegExp(
      `^(?:되어\\s*(?:나간|들어온)|된|한)\\s+([가-힣A-Za-z0-9 ]{0,24}?${unit})$`,
    ),
  );
  return counted ? { prefix, unit: clean(counted[1]) } : null;
}

export function checkSubtractionDefinitions(evidence) {
  const formulas = [],
    phrases = [];
  for (const [id, item] of Object.entries(evidence)) {
    if (item.kind && !["OCR", "원문"].includes(item.kind)) continue;
    const text = item.text;
    if (typeof text !== "string") continue;
    const doc =
      item.document ||
      item.label?.replace(/\s*\d+\s*(?:쪽|페이지|장)\s*$/, "").trim();
    for (const [pattern, target] of [
      [notation, formulas],
      [definition, phrases],
    ]) {
      for (const match of text.matchAll(pattern)) {
        const [, metric, left, right] = match;
        if (left === right) continue;
        const tail = text.slice(match.index + match[0].length);
        if (
          target === phrases &&
          !/^\s*(?:$|[,.。;\n]|(?:이다|입니다|임)(?=\s|[,.。;]|$)|으로\s*(?:[,，]|정의|계산|표시)|(?:을|을\s*)?(?:뜻|의미))/.test(
            tail,
          )
        )
          continue;
        if (/^\s*(?:은|는|이|가|으로)?\s*(?:아니|틀린|잘못)/.test(tail))
          continue;
        target.push({
          id,
          metric,
          left,
          right,
          quote: match[0],
          doc,
          ...context(text, match),
        });
      }
    }
  }
  const findings = [],
    seen = new Set();
  function add(a, b) {
    const key = JSON.stringify([
      a.metric,
      ...[a.id + " " + a.quote, b.id + " " + b.quote].sort(),
    ]);
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      status: "확인 필요",
      type: "원문 안의 불일치",
      method: "명시된 뺄셈 정의 대조",
      reason: `원문은 ‘${a.metric}’을 한 곳에서 ‘${a.left} − ${a.right}’, 다른 곳에서 ‘${a.right} − ${a.left}’ 순서로 설명합니다. 같은 지표·적용 범위인지 확인하세요.`,
      claim: { id: a.id, quote: a.quote },
      contrast: { id: b.id, quote: b.quote },
      refs: [...new Set([a.id, b.id])],
    });
  }
  for (const [i, a] of formulas.entries()) {
    // Two bare hyphens can be routes (서울-부산), not subtraction.
    for (const b of formulas.slice(i + 1))
      if (
        /[−]|차이\s*[)）]/.test(a.quote) &&
        /[−]|차이\s*[)）]/.test(b.quote) &&
        compatible(a, b) &&
        a.left === b.right &&
        a.right === b.left
      )
        add(a, b);
    for (const b of phrases) {
      if (!compatible(a, b)) continue;
      const lhs = quantity(b.left, a.right),
        rhs = quantity(b.right, a.left);
      if (!lhs || !rhs || lhs.unit !== rhs.unit) continue;
      const commonScope =
        clean(lhs.prefix) === clean(rhs.prefix) ||
        (!rhs.prefix &&
          /^(?:해당|같은|동일한)\s*(?:시간|기간)(?:\s*동안|의)?(?:\s+[가-힣]{1,10}에)?$/.test(
            lhs.prefix,
          ));
      if (commonScope) add(a, b);
    }
  }
  return findings;
}
