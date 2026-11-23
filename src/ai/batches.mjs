// AI 요청 한 번에 보낼 만큼씩 나누기

// 배열을 size개씩 자른다.
export const chunk = (xs, size) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, i * size + size));

// JSON 글자 수가 limit을 넘지 않게 순서대로 묶는다. 한 항목이 limit보다 커도 혼자 한 묶음이 된다.
export function pack(entries, limit) {
  const batches = [];
  let batch = [],
    size = 0;
  for (const entry of entries) {
    const next = JSON.stringify(entry).length;
    if (batch.length && size + next > limit) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(entry);
    size += next;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

// 문서 전체를 한 번에 보낼 때 한 요청에 담는 글자 수. 넘으면 원문 [ID, 구절]을 쪽 순서대로 나눠 보낸다.
export const SCAN_CHARS = 60000;
export const sourceParts = (evidence, room = SCAN_CHARS) =>
  pack(Object.entries(evidence).map(([id, e]) => [id, e.text]), room);
