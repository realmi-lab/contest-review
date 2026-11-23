// 요약 문장을 그 문장이 인용한 원문과 글자로 대조한다(수치·단위·목표와 실적·법적 역할 등).
const compact = (s) => s.normalize("NFKC").replace(/\s+/g, "");
const freeTerm = /무료|무상(?:으로|대여|제공|이용)/g;
function statesFree(text) {
  return text.split(/[.!?。;\n,]/).some((part) => {
    const s = compact(part);
    for (const m of s.matchAll(freeTerm)) {
      const rest = s.slice(m.index + m[0].length, m.index + m[0].length + 28);
      if (
        /^(?:인지|여부|이용여부|이용가능여부|라는근거|라고단정할수없|라는정보가없|가아니|는아니|가아님|가아닐|가아닌)/.test(
          rest,
        )
      )
        continue;
      if (
        /^(?:로|으로)?(?:제공|대여|이용|운영|지원)(?:하지않|되지않|하는지|되는지|여부)/.test(
          rest,
        )
      )
        continue;
      return true;
    }
    return false;
  });
}
function supportsFree(source) {
  const s = compact(source);
  return (
    statesFree(source) ||
    /(?:이용료|대여료|이용요금)(?:는|가|은|이|:)?(?:0원|없(?:다|음|습니다))/.test(
      s,
    ) ||
    /돈을받지않/.test(s)
  );
}
const qty =
  /(?<![\d.,])(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(%p|%|°[CF]|억\s*원|만\s*원|천\s*원|원|주(?:간)?|개월|시간|분|명|건|개)(?![A-Za-z])/gi;
function amounts(s) {
  const normalized = s.normalize("NFKC").replaceAll("−", "-");
  const matches = [...normalized.matchAll(qty)];
  const directions = {
    이상: ">=",
    이하: "<=",
    초과: ">",
    미만: "<",
    "≥": ">=",
    "≤": "<=",
  };
  return matches.map((m) => {
    const after = normalized
      .slice(m.index + m[0].length)
      .match(/^\s*(이상|이하|초과|미만)/)?.[1];
    const before = normalized.slice(0, m.index).match(/([<>]=?|[≤≥])\s*$/)?.[1];
    return {
      key:
        Number(m[1].replaceAll(",", "")) +
        m[2].toLowerCase().replace(/\s+/g, "").replace("주간", "주"),
      raw: m[0],
      limit: directions[after] || directions[before] || before,
    };
  });
}
const sentenceBreak = /[!?。;\n]|(?<!\d)\.|\.(?!\d)/;
const goal = /목표|예상|예측|예정|기대|추정|계획|가정|전망/;
const achieved =
  /달성(?:했|하였|됐다|되었|하였다)|단축(?:했|되었|됐다|하였)|감소(?:했|하였|했다|하였다)|절감(?:했|하였)|실측(?:된|으로확인)|측정결과/;

// Detect a shift from "the activity under article A, which may proceed under
// decree B" to "per A and B". Joint citations in the source stay valid.
function combinesLegalRoles(summary, source) {
  const article = String.raw`제\d+조(?:의\d+)?(?:제\d+항)?`;
  const joint = new RegExp(
    `법(${article})(?:과|와|및)(?:[가-힣]{0,25}?)(시행령|시행규칙)(${article})(?:에따라|에근거)`,
    "g",
  );
  const original = compact(source);
  return [...compact(summary).matchAll(joint)].some(
    ([wording, law, rule, clause]) => {
      if (original.includes(wording)) return false;
      return new RegExp(
        `법${law}에따른[^.!?。]{1,70}?(?:은|는)[,，]?[^.!?。]{0,25}?${rule}${clause}에따라`,
      ).test(original);
    },
  );
}

function assertsPossibleNegative(summary, cited) {
  const statements = summary.split(/[,，.!?。;\n]/).map(compact);
  for (const source of cited) {
    for (const [, stem] of source
      .normalize("NFKC")
      .matchAll(/([가-힣]{2,12})\s*하지\s*않을\s*수(?:도)?\s*있/g)) {
      const definite = new RegExp(
        stem + "하지않(?:으며|는다|습니다|았다|았으|았고|다|고)",
      );
      if (cited.some((s) => definite.test(compact(s)))) continue;
      if (
        statements.some(
          (s) =>
            definite.test(s) &&
            !/수(?:도)?있|가능성|우려|추정|것으로보|듯/.test(s),
        )
      )
        return true;
    }
  }
  return false;
}
export function directChecks(
  statement,
  evidence,
  { preserveDetails = false } = {},
) {
  const cited = statement.refs.map((r) => evidence[r].text);
  const source = cited.join(" ");
  const findings = [];
  if (statesFree(statement.text) && !supportsFree(source))
    findings.push("인용문에 무료 이용 조건이 없습니다.");
  const sourceAmounts = amounts(source);
  const present = new Set(sourceAmounts.map((x) => x.key));
  // In a table, the unit can be in a separate header cited alongside bare values.
  if (preserveDetails && /[%％]|퍼센트|백분율|\bpercent\b/i.test(source)) {
    for (const text of cited) {
      for (const row of text.split("\n").filter((line) => line.includes("|"))) {
        for (const cell of row.split("|").map((x) => x.trim())) {
          if (/^-?\d+(?:\.\d+)?$/.test(cell)) present.add(Number(cell) + "%");
        }
      }
    }
  }
  for (const n of amounts(statement.text)) {
    if (!present.has(n.key))
      findings.push("인용문에서 수치·단위 " + n.raw + "을 확인할 수 없습니다.");
    if (preserveDetails && n.limit) {
      const sameValue = sourceAmounts.filter((x) => x.key === n.key);
      if (
        sameValue.length &&
        sameValue.every((x) => x.limit && x.limit !== n.limit)
      )
        findings.push(
          "인용문의 " +
            n.raw +
            " 적용 범위와 요약의 이상·이하 또는 초과·미만 조건이 다릅니다.",
        );
    }
  }
  for (const clause of statement.text.split(sentenceBreak)) {
    if (!achieved.test(compact(clause)) || goal.test(clause)) continue;
    for (const n of amounts(clause)) {
      const lines = cited
        .flatMap((s) => s.split(sentenceBreak))
        .filter((l) => amounts(l).some((x) => x.key === n.key));
      if (
        lines.length &&
        lines.every((l) => goal.test(l) && !achieved.test(compact(l)))
      ) {
        findings.push("인용문의 목표·예상을 달성한 결과로 표현했습니다.");
        break;
      }
    }
  }
  const timeline = (text) => {
    const found = new Map();
    for (const clause of text.split(/[.;!?。\n]/)) {
      const words = compact(clause);
      for (const action of words.matchAll(
        /집계|정산|지급|발표|측정|배치|조사/g,
      )) {
        const before = words.slice(
          Math.max(0, action.index - 24),
          action.index,
        );
        const marks = [
          ...before.matchAll(
            /(?:종료|완료|운영|시험|검증)(?:한)?(?:이후|후|뒤)|(?:운영|시험|검증|종료)(?:하기)?(?:이전|전)|(?:기간동안|운영기간에|운영중|기간중)/g,
          ),
        ];
        if (!marks.length) continue;
        const m = marks.at(-1)[0];
        const stage = /(후|뒤)$/.test(m)
          ? "이후"
          : /전$/.test(m)
            ? "이전"
            : "진행 중";
        if (!found.has(action[0])) found.set(action[0], new Set());
        found.get(action[0]).add(stage);
      }
    }
    return found;
  };
  const sourceStages = timeline(source);
  const summaryStages = timeline(statement.text);
  for (const [action, stages] of summaryStages) {
    const expected = sourceStages.get(action);
    if (expected?.size === 1 && [...stages].some((t) => !expected.has(t)))
      findings.push(
        action + " 시점이 인용문의 " + [...expected][0] + "와 다릅니다.",
      );
  }
  if (preserveDetails) {
    const rate = /오차[율률]|백분[율률]\s*오차|퍼센트\s*오차|\b(?:MAPE|percentage error|error rate)\b/i;
    if (/\bMAE\b|평균\s*절대\s*오차/i.test(source) && rate.test(statement.text) && !rate.test(source))
      findings.push("인용문은 평균 절대 오차(MAE)를 제시하며 오차율은 확인되지 않습니다.");
    if (combinesLegalRoles(statement.text, source))
      findings.push(
        "요약에서 서로 다른 역할의 법률 조항과 하위 법령 조항을 공동 근거로 합쳤습니다.",
      );
    if (assertsPossibleNegative(statement.text, cited))
      findings.push("인용문에서 가능성으로 설명한 부정적 상황을 확정했습니다.");
    const mechanisms = [
      [
        /(?:상세|수치|별도|새로운|안내)\s*표(?:로|를)|표로\s*(?:대체|기재|통지|작성)/,
        /(?:도표|표로|표를|표에|표\s*형태|표\s*형식|테이블)/,
      ],
      [/대시보드(?:를|로|에서)/, /대시보드|대쉬보드|dashboard/i],
      [/문자(?:로|를)\s*(?:안내|발송|통지)/, /문자|SMS|메시지/i],
      [/이메일(?:로|을)\s*(?:안내|발송|통지)/, /이메일|전자우편|메일|e-?mail/i],
    ];
    if (
      mechanisms.some(
        ([stated, supported]) =>
          stated.test(statement.text) && !supported.test(source),
      )
    )
      findings.push(
        "요약이 인용문에 없는 전달 형식이나 구현 수단을 지정했습니다.",
      );
    if (
      /것으로\s*보(?:입니다|인다)|것으로\s*추정/.test(source) &&
      /감소가\s*발생|감소했다|증가했다|증가가\s*발생|입증됐다|확인되었다/.test(
        statement.text,
      ) &&
      !/것으로\s*(?:보|추정)|추정한다/.test(statement.text)
    )
      findings.push("제출자가 추정한 변화를 확정된 현상으로 표현했습니다.");
    const futureActions = compact(source).matchAll(
      /(확인|측정|집계|검토|조사|실시|운영|시행|추진|도입|실행|배치|제공)할예정/g,
    );
    for (const match of futureActions) {
      if (
        compact(statement.text).includes(match[1] + "한다") &&
        !/예정|계획/.test(statement.text)
      )
        findings.push(
          "원문에 명시된 " + match[1] + " 예정이라는 조건이 생략됐습니다.",
        );
    }
    for (const [action, stages] of sourceStages) {
      if (
        stages.size === 1 &&
        statement.text.includes(action) &&
        !summaryStages.has(action)
      )
        findings.push(action + " 시점이 요약에서 생략됐습니다.");
    }
    if (/기록|입력|작성|수집/.test(statement.text)) {
      const dates =
        compact(source).match(
          /(?:대여|반납|신청|등록|측정|접수|지급)일(?=과|과는|을|은|이|,|및|자)/g,
        ) ?? [];
      for (const field of dates) {
        if (!compact(statement.text).includes(field))
          findings.push(
            "원문에 명시된 " + field + " 기록 항목이 생략됐습니다.",
          );
      }
    }
  }
  return [...new Set(findings)];
}
