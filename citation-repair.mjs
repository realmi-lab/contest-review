// Replace weak example citations only when each coordinated example has its
// own distinctive words in a single, unambiguous passage on an already cited page.
const compact = (s) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const generic = new Set([
  "예시",
  "예를",
  "기타",
  "항목",
  "요소",
  "기준",
  "방법",
  "관련",
  "경우",
  "여부",
  "문제",
  "가능",
  "포함",
  "제외",
  "정보",
  "결과",
  "예정",
  "계획",
  "제공",
  "방안",
  "운영",
  "적용",
  "정도",
  "이용",
  "선택",
  "어려움",
]);
function examples(text) {
  const groups = [];
  for (const [, inside] of text.matchAll(/[（(]([^（）()]{3,85})[）)]/g)) {
    if (/[\d%=<>~±]/.test(inside)) continue;
    const items = inside.split(/[,，·]|\s+또는\s+/);
    if (items.length < 2 || items.length > 5) continue;
    const vocabulary = items.map((s) => [
      ...new Set(
        (s.match(/[가-힣]{2,}|[A-Z][A-Za-z]{2,}/g) || [])
          .map(compact)
          .filter((w) => !generic.has(w)),
      ),
    ]);
    const distinct = vocabulary.map((words, i) =>
      words.filter((w) =>
        vocabulary.every((other, j) => j === i || !other.includes(w)),
      ),
    );
    if (distinct.every((words) => words.length)) groups.push(distinct);
  }
  return groups;
}
function readable(e) {
  if (!e?.text || (e.kind && !["OCR", "원문"].includes(e.kind))) return false;
  const text = e.text;
  return (
    (text.match(/[가-힣]/g) || []).length >= 16 &&
    /(?:다|함|음|임|됨)(?:[.。]|\s*$)/.test(text) &&
    !text.includes("|")
  );
}
function pickPassage(group, rows, current) {
  const covers = (s) =>
    group.every(
      (words) =>
        words.filter((w) => s.includes(w)).length >= Math.min(2, words.length),
    );
  const hits = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (!readable(a)) continue;
    if (covers(a.clean)) {
      hits.push([a.id]);
      continue;
    }
    const b = rows[i + 1];
    if (
      !b ||
      b.page !== a.page ||
      b.number !== a.number + 1 ||
      !readable(b) ||
      covers(b.clean)
    )
      continue;
    if (covers(a.clean + b.clean)) hits.push([a.id, b.id]);
  }
  const linked = hits.filter((ids) => ids.every((id) => current.includes(id)));
  if (linked.length === 1) return linked[0];
  return hits.length === 1 ? hits[0] : null;
}
export function repairExampleRefs(point, evidence) {
  if (point.mode !== "요약" || !Array.isArray(point.refs)) return point;
  const groups = examples(point.text);
  if (!groups.length) return point;
  const pages = new Set(
    point.refs.map((id) => evidence[id]?.capture).filter(Boolean),
  );
  const rows = Object.entries(evidence)
    .filter(([, e]) => pages.has(e.capture))
    .map(([id, e]) => ({
      ...e,
      id,
      page: e.capture,
      number: Number(/\.(\d+)$/.exec(id)?.[1]),
      clean: compact(e.text),
    }))
    .sort((a, b) => a.page.localeCompare(b.page) || a.number - b.number);
  const passages = groups.map((g) => pickPassage(g, rows, point.refs));
  if (passages.some((p) => !p)) return point;
  const needed = [...new Set(passages.flat())];
  if (needed.every((id) => point.refs.includes(id))) return point;
  const old = point.refs.filter(
    (id) =>
      !needed.includes(id) &&
      /[가-힣A-Za-z]{2,}/.test(evidence[id]?.text || ""),
  );
  let refs = [...needed, ...old];
  if (refs.length > 4) {
    const outside = point.text.replace(/[（(][^（）()]*[）)]/g, " ");
    const anchors = [
      ...new Set(
        (outside.match(/[가-힣]{2,}|[A-Z][A-Za-z]{2,}|\d+(?:[.,]\d+)?/g) || [])
          .map((t) =>
            compact(t).replace(/(?:에서|으로|에게|은|는|이|가|을|를|의|과|와)$/, ""),
          )
          .filter((t) => t && !generic.has(t)),
      ),
    ];
    const body = needed.map((id) => compact(evidence[id].text));
    const support = old.map((id) => ({
      id,
      words: anchors.filter(
        (w) =>
          !body.some((t) => t.includes(w)) &&
          compact(evidence[id].text).includes(w),
      ),
    }));
    const remaining = new Set(support.flatMap((p) => p.words));
    refs = needed.slice();
    while (remaining.size && refs.length < 4) {
      const ranked = support
        .map((p) => ({
          id: p.id,
          words: p.words.filter((w) => remaining.has(w)),
        }))
        .sort((a, b) => b.words.length - a.words.length);
      if (
        !ranked[0]?.words.length ||
        ranked[1]?.words.length === ranked[0].words.length
      )
        return point;
      refs.push(ranked[0].id);
      ranked[0].words.forEach((w) => remaining.delete(w));
    }
    if (remaining.size || refs.length > 4) return point;
  }
  return { ...point, refs };
}
