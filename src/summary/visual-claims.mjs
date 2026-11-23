const normalize = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .trim();
const referenceId = /\bS\d+\.\d+\b/gi;
const number = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+/g;
const numbers = (text) =>
  (text.match(number) || []).map((n) => n.replaceAll(",", ""));

// 비율 옆에 적힌 날짜·눈금·점수만으로는 그 값이 어느 계열·문항·대상의 것인지 알 수 없다.
function numericFragment(text) {
  if (!/\d/.test(text)) return false;
  return !text
    .replace(number, "")
    .replace(
      /백만|천만|퍼센트|백분율|분기|개월|[년월일시분초주점절차회명인건개천만억조원배%％℃°]/gu,
      "",
    )
    .replace(/\b(?:USD|KRW|km|kg|ms|bp|pp|m|p)\b/gi, "")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function hasLabeledTable(cited) {
  const byCapture = new Map();
  for (const e of cited) {
    const rows = byCapture.get(e.capture) || [];
    for (const line of e.text.split("\n")) {
      if (line.includes("|")) rows.push(line.split("|").map((s) => s.trim()));
    }
    byCapture.set(e.capture, rows);
  }
  for (const rows of byCapture.values()) {
    for (let i = 0; i < rows.length - 1; i++) {
      const header = rows[i];
      if (!header.every((v) => v && /\p{L}/u.test(v) && !numericFragment(v)))
        continue;
      const values = rows[i + 1];
      if (
        values.length === header.length &&
        values.every(Boolean) &&
        values.some((v) => /\d/.test(v))
      )
        return true;
    }
  }
  return false;
}

const division = /[/÷∕⁄]|\\(?:d?frac)\b/u;
function rightHandSide(text) {
  const rhs = text
    .replace(/\|/g, " ")
    .match(/(?:[\p{L}\d_)])\s*=\s*([^。;\n!?]+)/u)?.[1];
  return (
    rhs?.split(/\.(?!\d)|(?:으로|이며|이고|입니다|이다)(?=\s|[,。.]|$)/u)[0] ||
    ""
  );
}
function introducesDivision(claim, cited) {
  // 본문과 주소의 빗금은 무시한다. 등식이 분명히 있고 그 오른쪽 안에 나눗셈이 있어야 한다(다음 문장이 아니라).
  const expression = rightHandSide(claim);
  if (!division.test(expression)) return false;
  const source = cited.map((e) => e.text).join("\n");
  if (/나누[어었는며기]|나눈|분의|분모로/.test(source)) return false;
  const original = source
    .replace(/\n\s*(?=[/÷∕⁄])/gu, " ")
    .split("\n")
    .map(rightHandSide)
    .filter(Boolean);
  if (original.length) return !original.some((rhs) => division.test(rhs));
  return !division.test(source.replace(/https?:\/\/\S+/gi, ""));
}

export function visualClaimProblem(point, evidence) {
  const cited = (point.refs || [])
    .map((id) => evidence[id])
    .filter(Boolean)
    .map((e) => ({ ...e, text: normalize(e.text) }))
    .filter((e) => e.text);
  if (!cited.length) return null;
  const claim = normalize(point.text);
  if (introducesDivision(claim, cited))
    return "요약 수식의 나눗셈을 인용한 원문에서 확인할 수 없습니다.";
  if (["표의 날짜·값 대조", "표의 열·값 대조"].includes(point.mode))
    return null;
  const texts = cited.map((e) => e.text);
  const withoutIds = claim.replace(referenceId, "");
  const pieces = texts.map((t) => t.replace(/[\p{P}\p{S}\s]/gu, ""));
  if (
    pieces.every((s) => s.length <= 2) &&
    withoutIds.length > 12 &&
    !rightHandSide(claim) &&
    (!texts.some((t) => /\d/.test(t)) || !/\d/.test(withoutIds))
  ) {
    return "인용한 항목이 낱글자나 짧은 기호여서 문장이 부여한 의미를 확인할 수 없습니다.";
  }
  if (
    texts.every((t) => t.length <= 20) &&
    /\bS\d+\.\d+\b/i.test(claim) &&
    /추정|가능성이|의미합|나타내는|관련된|관련이|가리키/.test(claim)
  ) {
    return "짧은 OCR 조각의 뜻을 추측한 문장입니다. 원래 화면의 항목을 확인하세요.";
  }
  if (!texts.some(numericFragment) || hasLabeledTable(cited)) return null;
  const anchored = texts.filter(
    (t) => !numericFragment(t) && /\p{L}{2}/u.test(t),
  );
  const claimedNumbers = numbers(withoutIds);
  if (claimedNumbers.length) {
    const explicit = new Set(anchored.flatMap(numbers));
    if (claimedNumbers.every((n) => explicit.has(n))) return null;
  } else if (anchored.some((s) => s.length >= 24 || withoutIds.includes(s))) {
    return null;
  }
  return "차트·표에서 따로 읽힌 숫자와 문장이 붙인 연도·단위·항목의 대응을 인용 근거에서 확인할 수 없습니다.";
}
