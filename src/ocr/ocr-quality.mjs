const clean = (s) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
// 두 판독의 숫자가 같아도 부호·비교 기호·금액 단위가 다르면 주장이 달라진다.
function numericReading(text) {
  const normalized = text.normalize("NFKC").replaceAll("−", "-");
  const tokens = normalized.match(
    /(?:[<>]=?|[≤≥±+\-])?\s*\d+(?:[.,]\d+)*(?:\s*(?:%p|%|‰|bp\b|°[CF]|억\s*원|만\s*원|천\s*원|원|달러))?/gi,
  );
  return (tokens || [])
    .map((token) => token.replace(/\s+/g, "").toLowerCase())
    .join("/");
}
export function needsDetail(page) {
  const kept = page.lines.filter((l) => !l.dropped);
  if (!kept.length) return true;
  const heights = kept.map((l) => l.box.h).sort((a, b) => a - b);
  return (
    heights[Math.floor(heights.length * 0.2)] <= 13 ||
    page.lines.length - kept.length >= 3 ||
    kept.filter((l) => l.confidence < 0.84).length >=
      Math.max(2, kept.length * 0.15)
  );
}
function overlaps(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (w * h) / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
}
export function reconcilePages(primary, detail) {
  const lines = primary.lines.filter((l) => !l.dropped).map((l) => ({ ...l }));
  const uncertain = [],
    extra = [];
  if (
    detail &&
    detail.width === primary.width &&
    detail.height === primary.height &&
    Math.abs(detail.deskewAngle - primary.deskewAngle) < 0.05
  ) {
    for (const alt of detail.lines.filter(
      (l) => !l.dropped && l.confidence >= 0.88,
    )) {
      const peers = lines
        .map((l, i) => ({ line: l, i }))
        .filter((p) => overlaps(p.line.box, alt.box) >= 0.35);
      if (!peers.length) {
        if (alt.text.trim().length < 2) continue;
        // 한 번만 읽힌 그래프 값도 확인할 수 있게 남긴다.
        if (numericReading(alt.text))
          uncertain.push({
            text: alt.text,
            box: alt.box,
            reason: "정밀 판독에서만 찾은 수치",
          });
        else if (alt.confidence >= 0.94) {
          extra.push(alt);
          lines.push({ ...alt, detail: true });
        }
        continue;
      }
      if (peers.length !== 1) continue;
      const old = peers[0].line,
        a = old.box,
        b = alt.box;
      if (
        Math.min(a.w, b.w) / Math.max(a.w, b.w) < 0.78 ||
        Math.min(a.h, b.h) / Math.max(a.h, b.h) < 0.68
      )
        continue;
      if (numericReading(old.text) !== numericReading(alt.text)) {
        old.numericDispute = true;
        uncertain.push({
          text: alt.text,
          original: old.text,
          box: alt.box,
          reason: "두 판독의 숫자가 다름",
        });
      }
    }
  }
  lines.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return { lines, uncertain, added: extra.length };
}
// 복원한 표의 행은 비지 않은 칸이 모두 같은 인쇄 줄에 같은 순서로 있을 때만 믿는다. 위치 번호는 그대로 둔다.
export function nativeTables(blocks, lines) {
  const tables = [];
  for (const block of blocks) {
    if (block.type !== "table" || !block.table?.cells?.length) continue;
    const rows = [];
    const used = new Set();
    let top = -Infinity;
    for (const cells of block.table.cells) {
      const labels = cells.map((c) => c.text.trim());
      const values = labels.filter(Boolean);
      if (values.length < 2) continue;
      const candidates = lines
        .map((l, i) => ({ l, i }))
        .filter(
          ({ l, i }) =>
            !used.has(i) &&
            !l.numericDispute &&
            l.box.y > top - 3 &&
            clean(l.text) === clean(values[0]),
        );
      let hit = null;
      for (const first of candidates) {
        const indexes = [first.i];
        let x = first.l.box.x;
        const cy = first.l.box.y + first.l.box.h / 2;
        for (const value of values.slice(1)) {
          const next = lines.findIndex(
            (l, i) =>
              !used.has(i) &&
              !l.numericDispute &&
              l.box.x > x &&
              Math.abs(l.box.y + l.box.h / 2 - cy) <=
                Math.max(3, l.box.h * 0.5) &&
              clean(l.text) === clean(value),
          );
          if (next < 0) break;
          indexes.push(next);
          x = lines[next].box.x;
        }
        if (indexes.length === values.length) {
          hit = indexes;
          break;
        }
      }
      if (!hit) {
        rows.length = 0;
        break;
      }
      rows.push({ text: labels.join(" | "), indexes: hit });
      hit.forEach((i) => used.add(i));
      top = lines[hit[0]].box.y;
    }
    if (rows.length >= 2) tables.push(rows);
  }
  return tables;
}
