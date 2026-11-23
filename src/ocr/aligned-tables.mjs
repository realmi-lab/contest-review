const percent = String.raw`([+−-]?\s*\d+(?:[.,]\d+)*\s*%p?)`;
const barePercent = new RegExp("^" + percent + "$", "i");
const numberedPercent = new RegExp("^(\\d+)\\s*[-–—]\\s*" + percent + "$", "i");
const label = String.raw`([\p{L}][\p{L}\p{N} ()]{0,38}?)`;
const separatedPercent = new RegExp(
  "^" + label + "\\s+[-–—]\\s+" + percent + "$",
  "iu",
);
const labeledPercent = new RegExp(
  "^" + label + "(?:\\s*[:：]\\s*|\\s+)" + percent + "$",
  "iu",
);

function percentEntry(raw) {
  const text = raw
    .normalize("NFKC")
    .trim()
    .replace(/^[•●▪·]\s*/, "");
  const bare = barePercent.exec(text);
  if (bare) return { label: "", value: bare[1].replace(/\s/g, "") };
  for (const [pattern, type] of [
    [numberedPercent, "number"],
    [separatedPercent, "dash"],
    [labeledPercent, "label"],
  ]) {
    const match = pattern.exec(text);
    if (match)
      return {
        label: match[1].trim(),
        value: match[2].replace(/\s/g, ""),
        type,
      };
  }
  return null;
}

function columnsUnder(header, lines, refs) {
  if (
    header.length < 3 ||
    header.some(
      (l) =>
        !l ||
        l.text.length > 40 ||
        !/\p{L}/u.test(l.text) ||
        /[%|\n]/.test(l.text),
    )
  )
    return [];
  const sorted = header.slice().sort((a, b) => a.cx - b.cx);
  if (new Set(sorted.map((l) => l.text)).size !== sorted.length) return [];
  const y = Math.max(...header.map((l) => l.cy));
  const height = Math.min(...header.map((l) => l.box.h));
  if (y - Math.min(...header.map((l) => l.cy)) > height * 0.55) return [];
  const centers = sorted.map((l) => l.cx);
  const borders = [centers[0] - (centers[1] - centers[0]) / 2];
  for (let i = 1; i < centers.length; i++)
    borders.push((centers[i - 1] + centers[i]) / 2);
  borders.push(centers.at(-1) + (centers.at(-1) - centers.at(-2)) / 2);
  if (
    sorted.some(
      (l, i) => l.box.x < borders[i] || l.box.x + l.box.w > borders[i + 1],
    )
  )
    return [];
  const columns = sorted.map((l) => ({
    name: l.text,
    ref: refs.get(l.index),
    entries: [],
    trusted: refs.has(l.index) && !l.numericDispute,
  }));
  let lastY = y,
    lastHeight = height;
  for (const l of lines) {
    if (
      l.cy <= y + height * 0.55 ||
      l.cx <= borders[0] ||
      l.cx >= borders.at(-1)
    )
      continue;
    if (l.cy - lastY > 3.5 * Math.max(l.box.h, lastHeight)) break;
    const cell = percentEntry(l.text);
    if (!cell) break;
    const col = borders.findIndex((edge) => l.cx < edge) - 1;
    // A box touching the divider can belong to either column. Preserve its OCR
    // as evidence but do not turn the layout into a factual assignment.
    if (l.box.x <= borders[col] || l.box.x + l.box.w >= borders[col + 1])
      return [];
    const column = columns[col];
    const previous = column.entries.at(-1);
    if (
      previous &&
      l.cy - previous.cy < Math.min(previous.height, l.box.h) * 0.55
    )
      return [];
    const ref = refs.get(l.index);
    column.entries.push({ ...cell, ref, cy: l.cy, height: l.box.h });
    if (!ref || l.numericDispute) column.trusted = false;
    lastY = l.cy;
    lastHeight = l.box.h;
  }
  if (columns.some((col) => !col.entries.length)) return [];
  return columns.filter((col) => col.trusted);
}

function columnPoint(column) {
  const { name, entries } = column;
  const numbered = entries.filter((cell) => cell.type === "number");
  // A range like 10–15% is not an item numbered 10. Accept ambiguous numeric
  // dashes only in a numbered list with a distinct named item as corroboration.
  const ordinalList =
    numbered.length >= 2 &&
    numbered.every((e, i) => e.label === String(i + 1)) &&
    entries.some((e) => e.type === "label" || e.type === "dash");
  if (
    !ordinalList &&
    entries.some((e) => e.type === "number" || e.type === "dash")
  )
    return null;
  const parts = entries.map(
    (e) =>
      (e.label ? e.label + (e.type === "number" ? "번 " : " ") : "") + e.value,
  );
  return {
    topic: "수치·일정·자원",
    text: name + " 항목은 " + parts.join(", ") + "입니다.",
    refs: [...new Set([column.ref, ...entries.map((e) => e.ref)])],
    mode: "표의 열·값 대조",
  };
}

// Derive the column from its on-screen boundaries, not a position in a row
// of text. Missing cells therefore do not shift later values one column left.
export function alignedPercentColumns(captures, evidence) {
  const points = [];
  for (const capture of captures) {
    const groups = Object.entries(evidence).filter(
      ([, e]) =>
        e.capture === capture.id &&
        e.kind === "OCR" &&
        Array.isArray(e.indexes),
    );
    const refs = new Map(
      groups.flatMap(([id, e]) => e.indexes.map((i) => [i, id])),
    );
    const byIndex = (capture.lines || []).map((line, index) => {
      const b = line.box;
      if (
        !b ||
        ![b.x, b.y, b.w, b.h].every(Number.isFinite) ||
        b.w <= 0 ||
        b.h <= 0
      )
        return null;
      return { ...line, index, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
    });
    const lines = byIndex
      .filter(Boolean)
      .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    const rows = [];
    for (const line of lines) {
      const row = rows.at(-1);
      if (
        row &&
        line.cy - row[0].cy <= 0.55 * Math.min(line.box.h, row[0].box.h)
      )
        row.push(line);
      else rows.push([line]);
    }
    for (const header of rows) {
      for (const column of columnsUnder(header, lines, refs)) {
        const point = columnPoint(column);
        if (point) points.push(point);
      }
    }
  }
  return points;
}
