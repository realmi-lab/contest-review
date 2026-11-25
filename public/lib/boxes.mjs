// OCR 글줄 상자(기울기 보정 전 좌표)를 그림 크기에 대한 비율(%)로 바꾼다.
// 작품 화면의 원문 패널(viewer.mjs)과 내보내기 HTML(share-html.mjs)이 인용 줄을 오렌지 상자로 표시할 때 함께 쓴다.
export function boxPercent(c, b) {
  const angle = c.ocrInfo?.deskewAngle || 0;
  const theta = (angle * Math.PI) / 180;
  const cx = (c.ocrWidth - 1) / 2;
  const cy = (c.ocrHeight - 1) / 2;
  const dx = b.x + b.w / 2 - cx;
  const dy = b.y + b.h / 2 - cy;
  const x = cx + dx * Math.cos(theta) + dy * Math.sin(theta) - b.w / 2;
  const y = cy - dx * Math.sin(theta) + dy * Math.cos(theta) - b.h / 2;
  const pct = (value, size) => (value / size) * 100;
  return { left: pct(x, c.ocrWidth), top: pct(y, c.ocrHeight), width: pct(b.w, c.ocrWidth), height: pct(b.h, c.ocrHeight), angle };
}

// 근거 하나(evidence 항목)가 가리키는 캡처 c의 글줄·그림 상자들
export const evidenceBoxes = (c, ev) =>
  (ev?.indexes || []).map((i) => c.lines[i]?.box).concat(ev?.boxes || []).filter(Boolean);
