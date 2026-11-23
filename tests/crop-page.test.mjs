// 창 캡처에서 쪽만 잘라 내기(cropToPage): 브라우저의 탭·주소창·뷰어 도구 막대, Word의 리본·눈금자·상태 표시줄과 회색 여백을 빼고 쪽만 남긴다.
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { cropToPage } from "../src/intake/attachment-pages.mjs";

const text = (x, y, t, fill = "#111") => `<text x="${x}" y="${y}" font-size="22" font-family="Arial" fill="${fill}">${t}</text>`;
// 가짜 Edge 창: 위에 탭 줄·주소창(·뷰어 도구 막대), 아래는 뷰어 바탕색 위에 흰 쪽 하나
function windowShot({ viewer = "#e6e6e6", page = { x: 650, y: 200, w: 700, h: 880 }, toolbar = true } = {}) {
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
// 가짜 Word 창: 위에 제목·리본·가로 눈금자, 왼쪽에 세로 눈금자, 아래에 상태 표시줄, 회색 바탕 가운데에 테두리 있는 흰 쪽 하나
function wordShot() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1500">
    <rect width="2400" height="1500" fill="#e9e9e9"/>
    <rect width="2400" height="300" fill="#f6f6f6"/>${text(40, 60, "제안서.docx")}${text(40, 200, "홈  삽입  그리기  디자인  레이아웃")}
    <rect y="300" width="2400" height="30" fill="#d8d8d8"/><rect x="900" y="300" width="600" height="30" fill="#fff"/>
    <rect y="330" width="36" height="1126" fill="#d8d8d8"/><rect y="440" width="36" height="900" fill="#fff"/>
    <rect y="1456" width="2400" height="44" fill="#f6f6f6"/>${text(40, 1488, "1/3쪽 · 단어 250개")}
    <rect x="823" y="360" width="754" height="1066" fill="#fff" stroke="#bdbdbd"/>
    ${text(900, 480, "로그인 알림 개선 제안")}${text(900, 540, "새 기기에서 로그인하면 바로 알린다")}
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

test("Word 창: 리본·눈금자·상태 표시줄과 회색 여백을 빼고 쪽만 남긴다", async () => {
  const [w, h] = await size(await cropToPage(await wordShot()));
  near(w, 754);
  near(h, 1066);
});

test("쪽이 창 가장자리에 닿아 경계를 알 수 없으면 자르지 않는다", async () => {
  const shot = await windowShot({ page: { x: 0, y: 150, w: 2000, h: 950 } });
  assert.ok((await cropToPage(shot)).equals(shot));
});

test("그림이 아니면 그대로 돌려준다", async () => {
  const text = Buffer.from("page 1");
  assert.equal(await cropToPage(text), text);
});
