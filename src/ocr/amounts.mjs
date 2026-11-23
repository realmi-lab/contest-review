// Only visible OCR numbers explicitly selected in the same unit are summed.
export function amountTokens(lines) {
  const values = [];
  for (const [index, line] of lines.entries()) {
    const matches = [
      ...line.text.matchAll(
        /(?<![0-9.,])[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,6})?(?![0-9.,])/g,
      ),
    ];
    for (const m of matches) {
      if (m[0].length > 23) continue;
      const unit =
        line.text
          .slice(m.index + m[0].length)
          .match(
            /^\s*(억원|천만원|백만원|만원|천원|원|개|건|명|시간|분|%)/,
          )?.[1] || "";
      values.push({
        id: index + "@" + m.index,
        line: index,
        number: m[0].replaceAll(",", "").replace("−", "-"),
        unit,
      });
    }
  }
  return values;
}
function fixed(n) {
  const [int, frac = ""] = n.replace("-", "").split(".");
  return (
    (n.startsWith("-") ? -1n : 1n) *
    (BigInt(int) * 1000000n + BigInt(frac.padEnd(6, "0")))
  );
}
function display(n) {
  const sign = n < 0n ? "-" : "";
  const value = n < 0n ? -n : n;
  const frac = String(value % 1000000n)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return sign + String(value / 1000000n) + (frac ? "." + frac : "");
}
export function checkSum(lines, parts, reported, unit) {
  if (
    !Array.isArray(parts) ||
    !parts.length ||
    new Set(parts).size !== parts.length ||
    parts.includes(reported)
  )
    throw Error("더할 항목과 별도의 표시 합계를 선택하세요.");
  if (typeof unit !== "string" || !unit.trim() || unit.trim().length > 16)
    throw Error("원문에서 확인한 공통 단위를 입력하세요.");
  const all = new Map(amountTokens(lines).map((x) => [x.id, x]));
  const chosen = [...parts, reported].map((id) => all.get(id));
  if (chosen.some((x) => !x)) throw Error("현재 원문에 없는 수치입니다.");
  if (chosen.some((x) => x.unit && x.unit !== unit.trim()))
    throw Error("원문 수치 단위와 공통 단위가 다릅니다.");
  const values = chosen.slice(0, -1);
  const shown = chosen.at(-1);
  const summed = values.reduce((a, b) => a + fixed(b.number), 0n);
  const difference = summed - fixed(shown.number);
  return {
    parts,
    reported,
    unit: unit.trim(),
    computed: display(summed),
    shown: shown.number,
    difference: display(difference),
    matches: difference === 0n,
    indexes: [...new Set(chosen.map((v) => v.line))],
    text:
      values.map((x) => x.number).join(" + ") +
      " = " +
      display(summed) +
      " " +
      unit.trim() +
      " / 원문 합계 " +
      shown.number +
      " " +
      unit.trim() +
      " · " +
      (difference === 0n ? "일치" : "불일치"),
  };
}
