import sharp from "sharp";
// 같은 영역을 다른 배율로 다시 읽는다. 글자열만 확인할 뿐, 숫자가 같아도 그래프의 범례나 단위까지 확인한 것은 아니다.
export async function corroborateValues(bytes, page, issues, parse) {
  if (!issues.length || Math.abs(page.deskewAngle || 0) > 0.05) return;
  const normalized = await sharp(bytes)
    .resize(page.width, page.height, { fit: "fill" })
    .flatten({ background: "white" })
    .png()
    .toBuffer();
  const width = 850,
    rowHeight = 88;
  for (let at = 0; at < Math.min(issues.length, 48); at += 10) {
    const group = issues.slice(at, Math.min(at + 10, 48)),
      layers = [];
    for (const [i, item] of group.entries()) {
      const b = item.box,
        padX = Math.max(3, Math.round(b.h * 0.45)),
        padY = Math.max(1, Math.round(b.h * 0.2));
      const left = Math.max(0, Math.floor(b.x - padX)),
        top = Math.max(0, Math.floor(b.y - padY));
      const w = Math.min(page.width - left, Math.ceil(b.x + b.w + padX) - left);
      const h = Math.min(page.height - top, Math.ceil(b.y + b.h + padY) - top);
      if (w < 2 || h < 2) continue;
      const tile = await sharp(normalized)
        .extract({ left, top, width: w, height: h })
        .resize({ width: width - 40, height: 58, fit: "inside" })
        .grayscale()
        .normalize()
        .png()
        .toBuffer();
      layers.push({ input: tile, left: 16, top: i * rowHeight + 14 });
    }
    if (!layers.length) continue;
    const sheet = await sharp({
      create: {
        width,
        height: group.length * rowHeight,
        channels: 3,
        background: "white",
      },
    })
      .composite(layers)
      .png()
      .toBuffer();
    const result = await parse(sheet, {
      ocr: true,
      ocrRec: "printed",
      ocrLines: true,
      ocrDetLongSide: 1280,
    });
    const view = result.ocrLines?.[0];
    if (!view || Math.abs(view.deskewAngle || 0) > 0.05) continue;
    const norm = (s) => s.normalize("NFKC").replace(/\s+/g, "");
    for (const line of view.lines) {
      const index = Math.floor(
        ((line.box.y + line.box.h / 2) * group.length) / view.height,
      );
      const item = group[index];
      if (!item || line.confidence < 0.88) continue;
      if (norm(line.text) === norm(item.text)) item.cropMatch = "정밀 판독";
      else if (item.original && norm(line.text) === norm(item.original))
        item.cropMatch = "기본 판독";
    }
  }
}
