// 칸을 화면에서 읽는 행 순서로 바꿔도, 근거 표시(위치 상자)를 위해 원래 글자 인식 번호는 그대로 둔다.
export function readingBlocks(lines) {
  const cells = lines.map((line, index) => ({ ...line, index }));
  if (!cells.every((c) => c.box?.h > 0 && c.box?.w > 0)) {
    return cells.map((c) => ({ text: c.text, indexes: [c.index] }));
  }
  cells.sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2));
  const rows = [];
  for (const cell of cells) {
    const cy = cell.box.y + cell.box.h / 2;
    const row = rows.at(-1);
    if (row && Math.abs(row.cy - cy) <= 0.42 * Math.min(row.h, cell.box.h)) {
      row.cells.push(cell);
    } else rows.push({ cy, h: cell.box.h, cells: [cell] });
  }
  const groups = [];
  for (const row of rows) {
    row.cells.sort((a, b) => a.box.x - b.box.x);
    const text = row.cells
      .map((c) => c.text.trim())
      .join(row.cells.length > 1 ? " | " : "");
    const x = row.cells[0].box.x;
    const last = groups.at(-1);
    // 줄바꿈된 본문은 보통 왼쪽이 맞고 줄 높이가 일정하다.
    // 표의 행, 글머리 기호, 문단 나눔, 새 제목은 새 묶음을 시작한다.
    const columns = row.cells.map(({ box }) => [box.x, box.x + box.w]);
    if (
      columns.length > 1 &&
      last?.columns?.length === columns.length &&
      last.rowCount < 8 &&
      row.cy - last.cy <= 2.6 * row.h &&
      last.text.length + text.length < 550 &&
      columns.every(
        ([left, right], i) =>
          Math.min(
            Math.abs(left - last.columns[i][0]),
            Math.abs(right - last.columns[i][1]),
          ) <=
          1.8 * row.h,
      )
    ) {
      last.text += "\n" + text;
      last.indexes.push(...row.cells.map((c) => c.index));
      last.rowCount++;
      last.cy = row.cy;
      continue;
    }
    const isList = /^(?:[①-⑳•●■□▶※]|[-·]\s|\d+[.)]\s|[ivx]+\.\s)/i.test(text);
    if (
      last &&
      row.cells.length === 1 &&
      last.single &&
      !isList &&
      Math.abs(last.x - x) <= row.h * 1.5 &&
      Math.abs(last.h - row.h) <= row.h * 0.23 &&
      row.cy - last.cy <= row.h * 1.95 &&
      last.indexes.length < 6 &&
      last.text.length + text.length < 390 &&
      !/[.!?。:：][”’"')\]]?$/.test(last.text)
    ) {
      last.text += " " + text;
      last.indexes.push(row.cells[0].index);
      last.cy = row.cy;
    } else
      groups.push({
        text,
        indexes: row.cells.map((c) => c.index),
        single: row.cells.length === 1,
        columns,
        rowCount: 1,
        cy: row.cy,
        x,
        h: row.h,
      });
  }
  return groups.map(({ text, indexes }) => ({ text, indexes }));
}

// 머리글이 있고, ISO 날짜가 커지는 순서이며, 값이 숫자인 두 열짜리 표만 시계열로 본다.
// 서로 다른 그래프의 값은 짝짓지 않는다.
export function observedSeries(blocks) {
  const points = [];
  for (const block of blocks) {
    const [header, ...lines] = block.text
      .split("\n")
      .map((row) => row.split("|").map((c) => c.trim()));
    if (
      header.length !== 2 ||
      !/[a-z가-힣]/i.test(header[1]) ||
      lines.length < 2
    )
      continue;
    if (
      !lines.every(
        (r, i) =>
          r.length === 2 &&
          /^\d{4}-\d{2}-\d{2}$/.test(r[0]) &&
          /^-?\d+(?:\.\d+)?$/.test(r[1]) &&
          (!i || lines[i - 1][0] < r[0]),
      )
    )
      continue;
    const metric = header[1];
    const unitBlock = blocks.find(
      (b) =>
        b.id !== block.id &&
        b.text.split("|").some((c) => c.trim() === metric) &&
        /\bpercent\b|퍼센트|백분율/i.test(b.text),
    );
    const unit = unitBlock ? "%" : "";
    const runs = [];
    for (const [day, value] of lines) {
      const last = runs.at(-1);
      if (last?.value === value) last.days.push(day);
      else runs.push({ value, days: [day] });
    }
    const rows = runs.map(
      ({ value, days }) => days.join("·") + " 관측값 " + value + unit,
    );
    const refs = unitBlock ? [block.id, unitBlock.id] : [block.id];
    points.push({
      topic: "실측·관찰 결과",
      text: metric + " 기록. " + rows.join(", ") + ".",
      refs,
      mode: "표의 날짜·값 대조",
    });
  }
  return points;
}

// 원래 줄을 빠짐없이 설명할 수 있으면 Kordoc이 복원한 표 칸을 쓴다.
// 위치로 묶은 결과가 이미 같으면 그 위의 열 머리글을 그대로 둔다.
export function preferNativeGroups(groups, tables = []) {
  const result = groups.slice();
  for (const rows of tables) {
    const keys = new Set(rows.flatMap((r) => r.indexes));
    if (!keys.size) continue;
    const matches = result.filter((g) => g.indexes.some((i) => keys.has(i)));
    if (
      !matches.length ||
      matches.some((g) => !g.indexes.every((i) => keys.has(i)))
    )
      continue;
    const native = {
      text: rows.map((r) => r.text).join("\n"),
      indexes: rows.flatMap((r) => r.indexes),
    };
    const first = result.indexOf(matches[0]);
    for (const g of matches) result.splice(result.indexOf(g), 1);
    result.splice(first, 0, native);
  }
  return result;
}

const isoDay = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const koreanDay = /^(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일$/;
const writtenDay = String.raw`(?:\d{4}-\d{2}-\d{2}|(?:\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일)`;
const measurementDates = new RegExp(
  `(${writtenDay})\\s*(?:(?:부터|에서|[~∼–])\\s*(${writtenDay})\\s*(?:까지)?|에(?:는)?)\\s*(?:(?:매월|매달|월별로)\\s*)?(?:측정|실측|조사)(?=되|됐|하|했|됨|함)`,
  "g",
);

function citesMeasurementDate(text) {
  if (
    /(?:측정|실측|조사|채취)\s*(?:일자|일시|시점|날짜|일(?:은|이|에|\s*[:|]))|\b(?:measurement|sampling|survey|collection)[_ ]date\b|\b(?:measured|sampled|surveyed|collected)\s+(?:on|at|every)\b/i.test(
      text,
    )
  )
    return true;
  return text
    .split(/[.。\n]/)
    .some(
      (line) =>
        /(?:\d{1,2}\s*일|\d{4}-\d{2}-\d{2}|매월\s*(?:첫날|첫째\s*날|말일))/.test(
          line,
        ) &&
        /(?:측정|실측|조사|채취)(?:를|가)?\s*(?:되|하|했|한|실시|진행)/.test(
          line,
        ),
    );
}

// 월별 시계열의 observation_date는 관측 기간을 뜻한다.
// 인용이 위치를 찾을 수 있도록 근거에는 원래 행 이름을 그대로 둔다.
export function qualifyObservationDates(point, evidence) {
  if (!["요약", "표의 날짜·값 대조"].includes(point.mode)) return point;
  const sources = point.refs.map((id) => evidence[id]?.text || "");
  if (sources.some(citesMeasurementDate)) return point;
  const tables = sources
    .map((s) =>
      s
        .trim()
        .split("\n")
        .map((l) => l.split("|").map((v) => v.trim())),
    )
    .filter(
      ([header, ...rows]) =>
        header.length === 2 &&
        /^observation[ _]date$/i.test(header[0]) &&
        header[1] &&
        rows.length &&
        rows.every(
          (r) =>
            r.length === 2 &&
            isoDay.test(r[0]) &&
            /^-?\d+(?:\.\d+)?$/.test(r[1]),
        ),
    );
  if (tables.length !== 1) return point;
  const [header, ...rows] = tables[0];
  const metric = header[1].toLowerCase();
  if (!point.text.toLowerCase().includes(metric)) return point;
  const monthly = sources.some((s) =>
    s
      .split("\n")
      .some(
        (line) =>
          line
            .split("|")
            .some((part) => part.trim().toLowerCase() === metric) &&
          /\bmonthly\b|월별|월간/i.test(line),
      ),
  );
  if (!monthly) return point;
  const days = rows.map(([day]) => day);
  if (
    !days.every((day, i) => {
      const date = new Date(day + "T00:00:00Z");
      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === day &&
        (!i || days[i - 1].slice(0, 7) < day.slice(0, 7))
      );
    })
  )
    return point;

  function resolveDay(token, impliedYear) {
    if (isoDay.test(token)) return days.includes(token) ? token : undefined;
    const [, year = impliedYear, month, day] = koreanDay.exec(token);
    const suffix = "-" + month.padStart(2, "0") + "-" + day.padStart(2, "0");
    const matches = days.filter(
      (d) => d.endsWith(suffix) && (!year || d.startsWith(year + "-")),
    );
    if (matches.length === 1) return matches[0];
  }
  const monthLabel = (d) =>
    d.slice(0, 4) + "년 " + Number(d.slice(5, 7)) + "월";
  let text;
  if (point.mode === "표의 날짜·값 대조") {
    text = point.text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (day) =>
      days.includes(day) ? monthLabel(day) : day,
    );
  } else {
    text = point.text.replace(measurementDates, (whole, start, end) => {
      const first = resolveDay(start);
      if (!first) return whole;
      if (!end) return monthLabel(first) + "의 관측값으로 제시";
      const last = resolveDay(end, first.slice(0, 4));
      if (!last || last < first) return whole;
      return (
        monthLabel(first) +
        "부터 " +
        monthLabel(last) +
        "까지 월별 관측값으로 제시"
      );
    });
  }
  return text === point.text ? point : { ...point, text };
}
