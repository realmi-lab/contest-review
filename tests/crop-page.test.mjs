// 브라우저 창 캡처에서 쪽만 잘라 내기(cropToPage): 탭·주소창·뷰어 도구 막대와 회색 여백을 빼고 쪽만 남긴다.
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { cropToPage } from "../src/intake/attachment-pages.mjs";

// 가짜 Edge 창: 위에 탭 줄·주소창(·뷰어 도구 막대), 아래는 뷰어 바탕색 위에 흰 쪽 하나
function windowShot({ viewer = "#e6e6e6", page = { x: 650, y: 200, w: 700, h: 880 }, toolbar = true } = {}) {
  const text = (x, y, t, fill = "#111") => `<text x="${x}" y="${y}" font-size="22" font-family="Arial" fill="${fill}">${t}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1100">
    <rect width="2000" height="1100" fill="${viewer}"/>
    <rect width="2000" height="70" fill="#2b2b2b"/><rect x="90" y="14" width="300" height="56" rx="8" fill="#3c3c3c"/>${text(110, 50, "보호 문서.pdf", "#eee")}
    <rect y="70" width="2000" height="70" fill="#3c3c3c"/><rect x="160" y="82" width="1500" height="46" rx="23" fill="#202020"/>${text(190, 113, "file:///Users/me/OneDrive/보호 문서.pdf#page=1", "#ccc")}
    ${toolbar ? `<rect y="140" width="2000" height="44" fill="#f7f7f7"/>${text(960, 170, "1 / 3")}` : ""}
    <rect x="${page.x}" y="${page.y}" width="${page.w}" height="${page.h}" fill="#fff"/>
    ${text(page.x + 60, page.y + 80, "우산 대여 시범 운영 계획")}${text(page.x + 60, page.y + 130, "예산 2,500,000원 · 3개 층")}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const size = async (png) => sharp(png).metadata().then((m) => [m.width, m.height]);
const near = (actual, expected, by = 12) => assert.ok(Math.abs(actual - expected) <= by, `${actual} ≈ ${expected}`);

test("밝은 뷰어: 탭·주소창·도구 막대와 회색 여백을 빼고 쪽만 남긴다", async () => {
  const [w, h] = await size(await cropToPage(await windowShot()));
  near(w, 700);
  near(h, 880);
});

test("어두운 뷰어 바탕에 도구 막대가 없어도 쪽만 남긴다", async () => {
  const [w, h] = await size(await cropToPage(await windowShot({ viewer: "#525659", toolbar: false })));
  near(w, 700);
  near(h, 880);
});

test("쪽이 창 가장자리에 닿아 경계를 알 수 없으면 자르지 않는다", async () => {
  const shot = await windowShot({ page: { x: 0, y: 150, w: 2000, h: 950 } });
  assert.ok((await cropToPage(shot)).equals(shot));
});

test("그림이 아니면 그대로 돌려준다", async () => {
  const text = Buffer.from("page 1");
  assert.equal(await cropToPage(text), text);
});
