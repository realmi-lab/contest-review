// The expanded view uses only this reading's saved statements and OCR.
// Source excerpts stay verbatim and retain the coordinates of every line.
const compact = (text) =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
const tag = (p, topic) => ({ ...p, topic });
const sameSource = (a, b) => a.refs.some((id) => b.refs.includes(id));

function trigrams(text) {
  const s = compact(text);
  return new Set(
    Array.from({ length: Math.max(0, s.length - 2) }, (_, i) =>
      s.slice(i, i + 3),
    ),
  );
}

function overlap(grams, seen) {
  if (!grams.size) return 0;
  let common = 0;
  for (const g of grams) if (seen.has(g)) common++;
  return common / grams.size;
}

function alreadyShown(point, shown) {
  const text = compact(point.text);
  return shown.some(
    (p) =>
      p.sourceNote === point.sourceNote &&
      (compact(p.text) === text ||
        (sameSource(p, point) && compact(p.text).includes(text))),
  );
}

function extraPoints(lead, points, limit) {
  const chosen = [],
    seen = new Set(lead.flatMap((p) => [...trigrams(p.text)]));
  const pool = points
    .filter((p) => p.text.length <= 500 && !alreadyShown(p, lead))
    .map((point, order) => ({ point, order, grams: trigrams(point.text) }));
  while (pool.length && chosen.length < limit) {
    let best = 0,
      bestScore = -1;
    for (const [i, item] of pool.entries()) {
      const score = 1 - overlap(item.grams, seen);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    const [item] = pool.splice(best, 1);
    if (
      !bestScore ||
      alreadyShown(
        item.point,
        chosen.map((c) => c.point),
      )
    )
      continue;
    chosen.push(item);
    for (const gram of item.grams) seen.add(gram);
  }
  return chosen.sort((a, b) => a.order - b.order).map((item) => item.point);
}

const sentenceEnd = /[.!?。！？][”’"'」)]*$/u;
const fragmentEnd = /[,，]$/u;
const signpost =
  /^(?:제\s*\d+\s*[장절]|참고\s*(?:자료|문헌)|목차|감사합니다|안녕하세요|제안을?\s*(?:들어|읽어)|.*(?:다음과 같습니다|만들어주세요)[.!]?$)/u;
const detailLanguage =
  /때문|이유|경험|직접|예를\s*들|예컨대|어려|불편|부담|거절|주고받|절차|통해서|활용|가능|신청|한해|참여|통해|예정|경우|조건|위해서|기대|대신|반면/u;
const scopedHeading =
  /^(?:[\d.()·\s-]*)(?:예시|가정|예외|제외\s*대상|금지\s*사항|기대\s*효과|제약\s*사항|목표|문제점)\s*[:：]?$/u;
const referential =
  /^(?:그(?:것|러한|래서|\s)|이러한|이처럼|이것|이를\s|그렇|여기서|그동안|하지만|반면|또한|또는)/u;
function consecutive(a, b) {
  return (
    a?.capture &&
    a.capture === b?.capture &&
    a.indexes?.length &&
    b.indexes?.length &&
    b.indexes[0] === a.indexes.at(-1) + 1
  );
}

function sourceExcerpts(reading, shown) {
  const entries = Object.entries(reading.evidence || {});
  if (entries.length > 48 || shown.some((p) => /^표의 /.test(p.mode || "")))
    return [];
  const unassigned = new Set(reading.unassigned || []);
  const context = new Set((reading.context || []).map((p) => p.ref));
  const restricted = new Set(
    [...(reading.visualChecks || []), ...(reading.sourceAlerts || [])].flatMap(
      (p) => p.refs,
    ),
  );
  const safe = ([id, row]) =>
    !restricted.has(id) &&
    /^(?:OCR|원문)$/u.test(row.kind) &&
    row.capture &&
    row.indexes?.length &&
    !/(?:https?:\/\/|[\w.+-]+@[\w.-]+)/u.test(row.text);
  const candidate = [];
  const known = new Set(shown.flatMap((p) => [...trigrams(p.text)]));
  for (let i = 0; i < entries.length; i++) {
    const [id, row] = entries[i];
    const prev = entries[i - 1];
    const adjacent = prev && consecutive(prev[1], row);
    // A one-line heading can establish that the following explanation is a
    // target or an example. Keep the heading even when the row is already cited.
    const labeled =
      adjacent &&
      scopedHeading.test(prev[1].text) &&
      !fragmentEnd.test(row.text) &&
      /(?:때문|통해|통한|경험|경우|반면)/u.test(row.text);
    if (
      (!unassigned.has(id) && !labeled) ||
      context.has(id) ||
      !safe(entries[i]) ||
      row.text.length < 24 ||
      row.text.length > 180 ||
      (!sentenceEnd.test(row.text) && !labeled) ||
      signpost.test(row.text) ||
      !detailLanguage.test(row.text)
    )
      continue;
    let refs = [id],
      text = row.text;
    if (
      adjacent &&
      (fragmentEnd.test(prev[1].text) || scopedHeading.test(prev[1].text))
    ) {
      if (
        !safe(prev) ||
        (context.has(prev[0]) && !scopedHeading.test(prev[1].text)) ||
        (entries[i - 2] &&
          consecutive(entries[i - 2][1], prev[1]) &&
          fragmentEnd.test(entries[i - 2][1].text))
      )
        continue;
      refs = [prev[0], id];
      text = prev[1].text + " " + text;
    } else if (
      referential.test(text) ||
      (adjacent && !sentenceEnd.test(prev[1].text) && !context.has(prev[0]))
    )
      continue;
    if (
      text.length > 255 ||
      alreadyShown({ text: row.text, refs: [id] }, shown)
    )
      continue;
    const novelty = 1 - overlap(trigrams(text), known);
    if (novelty >= 0.26) candidate.push({ text, refs, novelty, order: i });
  }
  const chosen = [];
  for (const item of candidate.sort((a, b) => b.novelty - a.novelty)) {
    if (!chosen.some((p) => sameSource(p, item))) chosen.push(item);
    if (chosen.length === 2) break;
  }
  return chosen
    .sort((a, b) => a.order - b.order)
    .map(({ text, refs }) => ({
      text,
      refs,
      sourceNote: "원문 발췌",
      topic: "원문에서 더 읽기",
    }));
}

export function expandedReading(reading) {
  if (!reading) return [];
  const evidence = reading.evidence || {};
  const backed = (p) =>
    typeof p?.text === "string" &&
    p.text.trim() &&
    p.refs?.length &&
    p.refs.every((ref) => Object.hasOwn(evidence, ref));
  const lead = (reading.lead || []).filter(backed);
  const points = (reading.points || []).filter(backed);
  const extra = extraPoints(lead, points, 12 - lead.length);
  return [
    ...lead.map((p) => tag(p, "핵심 내용")),
    ...extra.map((p) => tag(p, "추가 요점")),
    ...sourceExcerpts(reading, [...lead, ...extra]),
  ];
}

// Older saved readings have the grounded lead and points but no new editorial pass.
export function readingViews(reading) {
  const backed = (p) => p?.text?.trim() && p.refs?.length &&
    p.refs.every((id) => reading.evidence?.[id] && reading.evidence[id].kind !== "OCR 수치 대조 필요");
  const lead = (reading.lead || []).filter(backed);
  const edition = reading.edition?.version === 1 ? reading.edition : null;
  const key = (p) => compact(p.text).replace(/\p{P}/gu, "");
  const compactLead = lead.filter((p) => p.text.length <= 145);
  const brief = edition ? (edition.brief || []).filter(backed) :
    (compactLead.length ? [lead[0], ...compactLead.filter((p) => p !== lead[0])] : lead).slice(0, 4);
  const used = new Set(brief.map(key));
  const extra = edition ? [] : extraPoints(brief, (reading.points || []).filter(backed), 6);
  const details = edition ? (edition.detail || []) : [...extra, ...sourceExcerpts(reading, [...brief, ...extra])].slice(0, 7);
  // 핵심 요약이 이미 인용한 표의 수치 줄은 세부 내용에서 되풀이하지 않는다.
  const tableShown = (p) => /^표의 /u.test(p.mode || "") && brief.some((b) => b.refs.some((ref) => p.refs.includes(ref)));
  const detail = details.filter((p) => {
    if (!backed(p) || used.has(key(p)) || tableShown(p)) return false;
    used.add(key(p));
    return true;
  });
  return { brief, detail };
}

const FIGURE_CAPTION = /^\s*[[〈【(]?\s*(?:그림|도표|도식|사진|표)\s*\d+\b/u;
const numericLine = (text) => /\d/u.test(text) && /^[\d\s.,:%+\-−~()]+$/u.test(text);
// OCR 줄 위치를 그대로 쓸 수 있는 쪽인지(기울기 보정이 없고 크기를 아는 쪽)
const located = (c) => c.ocrWidth > 0 && c.ocrHeight > 0 && Math.abs(c.ocrInfo?.deskewAngle || 0) < 0.1;

// 쪽에 번호 붙은 그림 설명이 있으면 그 행과, 그림이 있을 만한 주변 영역을 돌려준다.
function figureCaption(reading, c) {
  const row = Object.entries(reading.evidence || {}).find(([, r]) =>
    r.capture === c.id && r.kind === "OCR" && r.text.length <= 140 && FIGURE_CAPTION.test(r.text));
  if (!row) return null;
  const box = row[1].indexes?.map((i) => c.lines?.[i]?.box).find(Boolean);
  if (!box || !located(c)) return { ref: row[0] };
  const h = Math.round(c.ocrHeight * 0.29);
  const top = Math.max(0, Math.min(c.ocrHeight - h, Math.round(box.y - h * 0.81)));
  return { ref: row[0], viewBox: [0, top, c.ocrWidth, h] };
}

// 그래프의 축 눈금이나 표의 숫자 칸이 모인 영역. 숫자만 있는 줄이 5개 이상이면 그래프·표로 본다.
// 머리글과 쪽 번호(위 10%, 아래 8%)는 세지 않고, 축 이름·범례가 잘리지 않게 여백을 둔다.
// 글자 상자들을 감싸는 영역 [x, y, 너비, 높이] (OCR 좌표). 가로·세로로 화면 크기의 padX·padY만큼 여백을 둔다.
function boxAround(c, boxes, padX, padY) {
  const W = c.ocrWidth, H = c.ocrHeight;
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - W * padX);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - H * padY);
  const right = Math.min(W, Math.max(...boxes.map((b) => b.x + b.w)) + W * padX);
  const bottom = Math.min(H, Math.max(...boxes.map((b) => b.y + b.h)) + H * padY);
  return [x, y, right - x, bottom - y].map(Math.round);
}

function chartArea(c) {
  if (!located(c)) return null;
  const H = c.ocrHeight;
  const boxes = (c.lines || []).filter((l) => l.box && numericLine(l.text || "") &&
    l.box.y > H * 0.1 && l.box.y + l.box.h < H * 0.92).map((l) => l.box);
  if (boxes.length < 5) return null;
  return boxAround(c, boxes, 0.12, 0.1);
}

// 근거로 인용된 줄들과 그 둘레(근거 미리보기에 쓴다). 위치를 알 수 없는 캡처면 null.
// 한 줄짜리 인용도 앞뒤 맥락이 보이게 높이를 너비의 45% 이상으로 넓힌다(실측: 제목 한 줄이 가는 띠로 보였다).
export function evidenceCrop(c, evidence) {
  const boxes = (evidence?.indexes || []).map((i) => c?.lines?.[i]?.box).filter(Boolean);
  if (!boxes.length || !located(c)) return null;
  const [x, y, w, h] = boxAround(c, boxes, 0.05, 0.07);
  const tall = Math.min(c.ocrHeight, Math.max(h, Math.round(w * 0.45)));
  const top = Math.min(Math.max(0, Math.round(y + h / 2 - tall / 2)), c.ocrHeight - tall);
  return { viewBox: [x, top, w, tall], boxes };
}

// 요점이 인용한 쪽 가운데 그림·도표가 있는 쪽을 요점 옆에 붙인다. 같은 쪽은 한 번만 쓴다.
// 수치를 말하는 요점부터 채운다. 표지·문단 쪽이나 글자만 있는 목록 표는 고르지 않는다.
export function representativeCaptures(reading, captures, points, limit = 3) {
  const byId = new Map(captures.map((c) => [c.id, c]));
  const hasNumber = (p) => /\d/u.test(p.text);
  const used = new Set(), chosen = [];
  for (const point of [...points.filter(hasNumber), ...points.filter((p) => !hasNumber(p))]) {
    if (chosen.length >= limit) break;
    for (const id of point.refs) {
      const c = byId.get(reading.evidence?.[id]?.capture);
      if (!c || used.has(c.id)) continue;
      const caption = figureCaption(reading, c), area = chartArea(c);
      if (!c.visual && !caption && !area) continue;
      used.add(c.id);
      chosen.push({
        point, capture: c.id, label: c.label, page: c.page, ref: caption?.ref || id,
        caption: point.text, viewBox: caption?.viewBox || area, width: c.ocrWidth, height: c.ocrHeight,
      });
      break;
    }
  }
  return chosen;
}

export function explainOcr(issue) {
  const basic = issue.original, fine = issue.text;
  let reason;
  if (!basic) reason = "기본 판독에서는 같은 위치에 대응하는 문장을 찾지 못했고 정밀 판독에서만 수치가 나왔습니다.";
  else {
    const tokens = (text) => text.normalize("NFKC").match(/[+−-]?\d+(?:[.,]\d+)*(?:\s*[%‰])?/gu) || [];
    const a = tokens(basic), b = tokens(fine);
    const diff = a.findIndex((v, i) => v !== b[i]);
    const left = a[diff], right = b[diff];
    const sign = (s) => s?.match(/^[+−-]/u)?.[0];
    if (left && right && left.includes(".") !== right.includes("."))
      reason = "같은 위치의 숫자에서 소수점 표기가 다르게 읽혔습니다.";
    else if (left && right && sign(left) !== sign(right))
      reason = "같은 위치의 수치 부호가 다르게 읽혔습니다.";
    else if (left && right && /[%‰]/u.test(left) !== /[%‰]/u.test(right))
      reason = "같은 위치에서 백분율 기호 인식이 다릅니다.";
    else reason = "같은 위치의 기본·정밀 판독에서 수치 또는 단위가 다르게 읽혔습니다.";
  }
  const crop = issue.cropMatch ? "확대 영역 재판독은 " + issue.cropMatch + "과 일치합니다." : "확대 대조로 일치한 값은 기록되지 않았습니다.";
  return { basic: basic || "대응 문장 없음", fine: fine || "기록 없음", reason, crop };
}
