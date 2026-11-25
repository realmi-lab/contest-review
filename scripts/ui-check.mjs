// 화면 점검: 임시 서버를 띄우고 헤드리스 Chrome으로 주요 화면을 눌러 본다. 브라우저 오류가 하나도 없어야 한다.
//   npm run ui-check   (Chrome 위치가 다르면 CHROME_PATH로 알려 준다)
// AI 요청은 가짜 응답(scripts/fake-ai.mjs)으로 바꿔 요약·점검 화면까지 비용 없이 본다. 실제 데이터와 설정은 건드리지 않는다.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => p && existsSync(p));
if (!chrome) {
  console.log("Chrome을 찾지 못해 화면 점검을 건너뜁니다. CHROME_PATH로 위치를 알려 주세요.");
  process.exit(0);
}
// 개발용 패키지(npm ci --omit=dev로 설치하면 없다)
const { default: puppeteer } = await import("puppeteer-core").catch(() => {
  console.log("puppeteer-core가 없습니다. 개발용 패키지까지 설치하세요: npm ci");
  process.exit(1);
});

// 임시 폴더: 데이터·설정, 그리고 가짜 AI 키(맥·윈도우 설정 위치 모두)
const temp = await mkdtemp(path.join(os.tmpdir(), "ui-"));
const home = path.join(temp, "home"), appData = path.join(home, "AppData");
for (const dir of [path.join(home, "Library", "Application Support", "ContestReviewDesk"), path.join(appData, "ContestReviewDesk")]) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "anthropic.key"), "sk-ant-fake");
}
const port = 19000 + Math.floor(Math.random() * 700);
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ["--import", "./scripts/fake-ai.mjs", "server.mjs"], { cwd: project, stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: appData, REVIEW_WEB_MODE: "", REVIEW_NAS_MODE: "",
    REVIEW_PORT: String(port), REVIEW_DATA_DIR: path.join(temp, "data"), REVIEW_SITE_FILE: path.join(temp, "site.json") } });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 조건이 될 때까지(최대 seconds초) 기다린다
async function until(what, check, seconds = 20) {
  for (let i = 0; i < seconds * 4; i++) {
    if (await check().catch(() => false)) return;
    await wait(250);
  }
  assert.fail(what + " — 시간 안에 되지 않았습니다");
}
const errors = [], failed = [];
let passed = 0;
async function step(name, run) {
  try { await run(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed.push(name); console.log("  ✗ " + name + "\n      " + String(e.message).split("\n")[0]); }
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  await until("서버 시작", () => fetch(base + "/api/state").then((r) => r.ok), 30);
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept()); // 요약 실행 확인 창
  const state = () => page.evaluate(() => fetch("/api/state").then((r) => r.json()));
  const isOpen = () => page.$eval("#dialog", (d) => d.open);
  const click = (selector) => page.$eval(selector, (el) => el.click());
  const press = async (key) => { await page.keyboard.press(key); await wait(600); };

  await step("목록 화면에 빌드 번호와 접수 칸이 나온다", async () => {
    await page.goto(base + "/", { waitUntil: "networkidle0" });
    await until("빌드 번호", async () => /빌드|버전/.test(await page.$eval("#build", (e) => e.textContent)));
    await until("접수 칸", async () => !!(await page.$("#create")));
  });
  await step("예제 작품을 만들면 캡처 자료 탭이 열리고 글자 인식이 끝난다", async () => {
    await click('[data-action="sample"]');
    await until("캡처 그림", async () => !!(await page.$(".capture-tile")));
    await until("글자 인식", async () => (await state()).tasks.length === 0, 180);
  });
  await step("캡처를 크게 보고 Esc로 닫는다", async () => {
    await click(".capture-tile");
    await until("크게 보기", isOpen);
    await press("Escape");
    assert.equal(await isOpen(), false);
  });
  await step("단축키 1~4로 단계를 옮긴다", async () => {
    for (const [key, title] of [["2", "AI 요약"], ["3", "AI 논리점검"], ["4", "채점표"], ["1", "캡처 자료"]]) {
      await press(key);
      assert.match(await page.$eval(".panetitle", (e) => e.textContent), new RegExp(title));
    }
  });
  await step("요약을 실행하면 점검까지 이어지고 요약·점검 탭에 결과가 나온다", async () => {
    const started = await page.evaluate(async () => {
      const { works } = await fetch("/api/state").then((r) => r.json());
      const w = await fetch("/api/work/" + works[0].id).then((r) => r.json());
      return (await fetch("/api/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: w.id, rev: w.rev }) })).status;
    });
    assert.equal(started, 202);
    await until("요약·점검", async () => (await state()).works.some((w) => w.hasLogic), 60);
    await press("2");
    await until("요약 내용", async () => !!(await page.$(".reading-content")));
    await press("3");
    await until("점검 내용", async () => /점검/.test(await page.$eval("#main", (e) => e.textContent)));
  });
  await step("내보내기는 채점표 탭에만 있고, 채점표의 메모는 저장해도 의견 수에 세지 않는다", async () => {
    assert.equal(await page.$('a[href^="/api/share/"]'), null); // AI 논리점검 탭
    await press("4");
    await until("채점표", async () => !!(await page.$("#review-note")));
    assert.ok(await page.$('a[href^="/api/share/"]'));
    await page.type('#review-note textarea[name="note"]', "화면 점검 메모");
    await page.$eval("#review-note", (f) => f.requestSubmit());
    const id = (await state()).works[0].id;
    await until("메모 저장", async () => (await page.evaluate((id) => fetch("/api/work/" + id).then((r) => r.json()), id)).reviewNote === "화면 점검 메모");
    assert.equal((await state()).works.some((w) => w.opinions > 0), false);
  });
  await step("다시 읽어오기: 원본이 없는 캡처는 글자를 다시 읽는다", async () => {
    const status = await page.evaluate(async () => {
      const { works } = await fetch("/api/state").then((r) => r.json());
      const w = await fetch("/api/work/" + works[0].id).then((r) => r.json());
      return (await fetch("/api/reread-captures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: w.id, rev: w.rev }) })).status;
    });
    assert.equal(status, 200);
    await until("다시 읽기", async () => (await state()).tasks.length === 0, 180);
    const w = await page.evaluate(async () => {
      const { works } = await fetch("/api/state").then((r) => r.json());
      return fetch("/api/work/" + works[0].id).then((r) => r.json());
    });
    assert.ok(w.captures.length && w.captures.every((c) => c.status !== "queued"));
  });
  await step("요약 설정·공모 연동 설정·운영 맥 점검 대화상자를 열고 닫는다", async () => {
    for (const action of ["summary-settings", "forms-settings", "self-check"]) {
      await click(`.sidebar [data-action="${action}"]`);
      await until(action, isOpen);
      if (action === "self-check") await until("점검 시작 버튼", async () => !!(await page.$('[data-action="self-check-run"]')));
      await click("#close");
      await wait(300);
    }
  });
  await step("목록으로 돌아가 검색하고, 표 위의 탭을 바꾼다", async () => {
    await click("#home");
    await until("목록", async () => !!(await page.$("#search")));
    await page.type("#search", "우산");
    await until("검색 결과", async () => /우산/.test(await page.$eval("#worklist", (e) => e.textContent)));
    // 표 위의 탭 네 개(전체 · AI 요약 · AI 논리점검 · 채점표)가 같은 작품을 단계별 결과로 보여 준다
    assert.deepEqual(await page.$$eval(".stagetab", (tabs) => tabs.map((t) => t.firstChild.textContent)), ["전체", "AI 요약", "AI 논리점검", "채점표"]);
    for (const [view, heading] of [["summary", "핵심 요약"], ["check", "AI 한마디 평"], ["sheet", "담당자 의견"], ["all", "의견"]]) {
      await click(`[data-list-view="${view}"]`);
      await until(heading, async () => (await page.$eval(".works-table thead", (e) => e.textContent)).includes(heading));
    }
  });
  await step("캡처를 모두 지우면 빈 접수 칸(끌어 놓기·파일 선택)이 다시 나온다", async () => {
    const { works } = await state();
    await page.goto(`${base}/?work=${works[0].id}`, { waitUntil: "networkidle0" });
    await until("캡처 자료", async () => !!(await page.$('[data-action="reset-captures"]')));
    await click('[data-action="reset-captures"]'); // 확인 창은 자동으로 수락한다
    await until("빈 접수 칸", async () => !!(await page.$("#drop")));
  });
  await step("접수 정보 수정에서 작품명을 고치면 제목이 바뀐다", async () => {
    await click('[data-action="edit-intake"]');
    await until("접수 정보 수정", isOpen);
    await page.$eval("#edit-name", (el) => (el.value = "이름을 고친 우산"));
    await page.$eval("#edit-intake", (f) => f.requestSubmit());
    await until("바뀐 제목", async () => /이름을 고친 우산/.test(await page.$eval("#main", (e) => e.textContent)));
    const { works } = await state();
    assert.ok(works.some((w) => w.name === "이름을 고친 우산"));
  });
  await step("브라우저 오류가 없다", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
  await rm(temp, { recursive: true, force: true });
}
console.log(failed.length ? `\n실패 ${failed.length}건: ${failed.join(" · ")}` : `\n화면 점검 ${passed}건 모두 통과`);
process.exit(failed.length ? 1 : 0);
