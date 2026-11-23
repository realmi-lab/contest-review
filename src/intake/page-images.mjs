// 첨부를 쪽 그림으로 바꿀 때 맥·윈도우가 함께 쓰는 도우미: 창 캡처에서 쪽만 잘라 내기, 같은 쪽·빈 화면 알아보기,
// MIP 보호 PDF(겉 PDF) 알아보기.
import { readFile } from "node:fs/promises";
import sharp from "sharp";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 한 가지 색뿐인 그림인가(앱이 보호 문서의 화면 캡처를 막으면 검은 화면만 찍힌다)
export const blank = (png) => sharp(png).stats().then((s) => s.channels.every((c) => c.stdev < 2), () => false);
// 같은 쪽 화면인가(마지막 쪽을 넘어가면 같은 화면이 다시 나온다). 바이트가 같거나, 원래 크기 그대로 비교해 다른 점이
// 거의 없으면(깜빡이는 커서 정도, 8점 이하) 같다. 숫자 한 글자만 달라도 수백 점이 달라 다른 쪽으로 본다(쪽을 놓치지 않게).
export async function samePage(a, b) {
  if (a.equals(b)) return true;
  const raw = (png) => sharp(png).raw().toBuffer({ resolveWithObject: true });
  const [x, y] = await Promise.all([raw(a), raw(b)]).catch(() => []);
  if (!x || !y || x.info.width !== y.info.width || x.info.height !== y.info.height) return false;
  const step = x.info.channels;
  let different = 0;
  for (let i = 0; i < x.data.length && different <= 8; i += step)
    if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) different++;
  return different <= 8;
}

// 창 캡처에서 쪽만 잘라 낸다(탭·주소창·리본·눈금자·옆 창·상태 표시줄·회색 바탕을 뺀다).
// 가운데 가로줄을 양 끝에서 안쪽으로 훑는다. 같은 색(바탕)이 길게 이어지다 끝나고, 끝난 곳의 세로줄이 바탕 아닌 색으로
// 길게 이어지면 거기가 쪽의 가장자리다. 왼쪽과 오른쪽에서 바탕색이 같은 가장자리 한 쌍을 찾아 그 사이를 남긴다.
// 그런 쌍이 없으면(쪽이 창 끝에 닿았거나 쪽이 아니면) 자르지 않는다.
export async function cropToPage(png) {
  try {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const mid = h >> 1;
    const at = (x, y) => (y * w + x) * 3;
    const near = (i, j) => Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) <= 24;
    // x 세로줄에서 가운데 줄 위아래로 test가 이어지는 범위 [위, 아래]
    const span = (x, test) => {
      let top = mid, bottom = mid;
      while (top > 0 && test(x, top - 1)) top--;
      while (bottom < h - 1 && test(x, bottom + 1)) bottom++;
      return [top, bottom];
    };
    // from에서 가운데 쪽(step)으로 가며 찾은 쪽 가장자리 후보들. 바탕은 너비의 3% 넘게, 가장자리 세로줄은 높이의 30% 넘게 이어져야 한다
    // (좁은 눈금자·스크롤 막대, 옆 창의 작은 그림은 건너뛴다). 세로 범위는 바탕이 위아래로 이어지는 문서 영역을 넘지 않는다.
    const edges = (from, step) => {
      const found = [];
      for (let x = from, start = from; (w / 2 - x) * step > 0; x += step) {
        const bg = at(start, mid);
        if (near(at(x, mid), bg)) continue;
        if ((x - start) * step >= w * 0.03) {
          const [areaTop, areaBottom] = span((start + x) >> 1, (px, py) => near(at(px, py), bg));
          const [top, bottom] = span(x + 2 * step, (px, py) => py >= areaTop && py <= areaBottom && !near(at(px, py), bg));
          if (bottom - top >= h * 0.3) found.push({ bg, x, top, bottom });
        }
        start = x;
      }
      return found;
    };
    const inset = Math.round(Math.min(w, h) * 0.012) + 8; // 창 테두리를 피한다
    const rights = edges(w - 1 - inset, -1);
    for (const l of edges(inset, 1))
      for (const r of rights) {
        if (!near(l.bg, r.bg) || r.x - l.x < w * 0.1) continue;
        const margin = 4;
        const left = Math.max(0, l.x - margin), top = Math.max(0, Math.min(l.top, r.top) - margin);
        const width = Math.min(w, r.x + margin + 1) - left, height = Math.min(h, Math.max(l.bottom, r.bottom) + margin + 1) - top;
        return await sharp(png).extract({ left, top, width, height }).png().toBuffer();
      }
    return png;
  } catch {
    return png; // 그림이 아니거나 읽지 못하면 그대로
  }
}

// MIP 보호 PDF는 '보호된 문서' 안내 쪽만 보이는 겉 PDF 안에 암호화된 본문을 담는다. PDFKit은 겉만 열어 안내 쪽을 내놓으므로,
// 그 표시(EncryptedPayload·MicrosoftIRMServices)가 있으면 PDFKit을 거치지 않고 보호 PDF로 다룬다.
export const wrapped = (pdf) => readFile(pdf).then((b) => b.includes("EncryptedPayload") || b.includes("MicrosoftIRMServices"), () => false);
