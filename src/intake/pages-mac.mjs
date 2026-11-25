// 맥에서 첨부 문서를 쪽 그림으로 바꾼다(osascript: AppleScript·JXA).
//   PDF: PDFKit으로 쪽마다 PNG. 보호(MIP) PDF는 Microsoft Edge로 열어 '다른 이름으로 저장'한 사본을 읽고,
//        안 되면 Edge(없으면 Adobe Acrobat Reader) 창을 쪽마다 화면 캡처
//   Word·PowerPoint·Excel: Office 앱이 회사 계정으로 열어(MIP 보호 문서 포함) 쪽마다 화면 캡처(Word는 쪽만 잘라 낸다).
//        Word는 먼저 PDF로 저장해 PDFKit으로 읽고(리본 없이 쪽 전체), 보호 문서라 막히면 화면 캡처로 간다.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { blank, cropToPage, samePage, wait, wrapped } from "./page-images.mjs";
import { osascript as osa } from "./scripting.mjs";

// -1743: macOS가 터미널의 앱 제어를 막았다
const automationHint = (app) => (e) => {
  throw /-1743/.test(e.message) ? new Error(`터미널이 ${app}를 제어할 수 없습니다. 시스템 설정 > 개인정보 보호 및 보안 > 자동화에서 허용하세요.`) : e;
};
// -1719·-25211·1002: 터미널에 손쉬운 사용 권한이 없어 키를 보낼 수 없다
const accessibilityHint = (e) => {
  throw /-1719|-25211|\(1002\)|assistive access|send keystrokes|보조 접근/i.test(e.message)
    ? new Error("터미널이 키 입력을 보낼 수 없습니다. 시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용에서 터미널을 허용하세요.") : e;
};
// 문서를 앱으로 연다(Launch Services). 앱을 앞으로 가져오지 않고, Office 샌드박스도 파일 접근을 허락받는다.
const launch = (app, file) =>
  new Promise((resolve, reject) =>
    execFile("open", ["-g", "-a", app, file], (e) => (e ? reject(new Error(`${app}로 문서를 열지 못했습니다.`)) : resolve())));

// PDF 쪽마다 긴 변 1600px PNG (흰 바탕은 캡처 접수 때 깐다)
const PDF_PAGES = `ObjC.import("PDFKit"); ObjC.import("AppKit");
function run([pdf, out, only]) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(pdf));
  if (!doc || doc.isNil() || doc.isLocked) throw new Error("열 수 없는 PDF(암호·보호 문서)");
  if (Number(only) > doc.pageCount) return "0"; // 없는 쪽
  const n = Math.min(doc.pageCount, Number(only) || 150);
  for (let i = Number(only) ? n - 1 : 0; i < n; i++) {
    const page = doc.pageAtIndex(i), box = page.boundsForBox(0).size;
    const scale = 1600 / Math.max(box.width, box.height);
    const image = page.thumbnailOfSizeForBox($.NSMakeSize(box.width * scale, box.height * scale), 0);
    const png = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation).representationUsingTypeProperties(4, $());
    png.writeToFileAtomically(out + "/" + String(i + 1).padStart(3, "0") + ".png", true);
  }
  return String(n);
}`;
async function pdfKitPages(pdf, only) {
  const out = await mkdtemp(path.join(os.tmpdir(), "pages-"));
  try {
    await osa(["-l", "JavaScript", "-e", PDF_PAGES, pdf, out, String(only || "")], "PDF");
    const names = (await readdir(out)).filter((n) => n.endsWith(".png")).sort();
    return await Promise.all(names.map((n) => readFile(path.join(out, n))));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
// 겉 PDF 표시가 있거나, Forms 첨부(secured: 모두 보호 문서)이고 Edge가 있으면 처음부터 보호 PDF로 연다(겉 PDF 판별이 빗나가도 안전하게).
// 그 밖에는 PDFKit으로 읽고, 못 열면 보호 PDF로 다룬다.
async function pdfPages(pdf, only, options) {
  if ((await wrapped(pdf)) || (options.secured && (await installed(EDGE)))) return protectedPdf(pdf, only, options);
  return pdfKitPages(pdf, only).catch(() => protectedPdf(pdf, only, options));
}

// Office 문서: 앱으로 열어 쪽(슬라이드·시트)마다 받는다. MIP로 보호된 문서는 PDF로 내보내도 암호화되어
// 읽을 수 없으므로, PowerPoint는 슬라이드를 PNG로 내보내고(화면을 쓰지 않음, 막혀 있으면 창 모드 슬라이드 쇼 캡처),
// Word는 '한 쪽 전체' 배율로 창을 캡처해 쪽만 잘라 내고(리본·눈금자·상태 표시줄을 뺀다), Excel은 시트마다 창을 캡처한다.
// 창은 앞으로 가져오지 않는다(가려져도 창 번호로 캡처).
// 이 서버를 띄운 터미널에 Office '제어'와 '화면 기록' 권한이 있어야 한다.
// 문서는 Launch Services(open -g -a)로 연다: Office 샌드박스가 파일 접근을 허락받고, 앱을 앞으로 가져오지 않는다.
// 그 뒤로는 문서 이름(n)으로 다룬다. Office의 AppleScript는 버전마다 받는 문장이 달라, 단계마다 문장을 따로 실행한다:
//   prepare·close는 되는 것만 하고(실패해도 넘어감), count·go는 적힌 순서대로 처음 되는 문장을 쓴다.
const STEPS = {
  powerpoint: {
    app: "Microsoft PowerPoint",
    doc: "presentation",
    // 전체 화면 대신 창 모드로, 애니메이션 없이(다음 슬라이드로 한 번에 넘어가게) 슬라이드 쇼를 띄운다.
    prepare: [
      `set show type of slide show settings of presentation n to slide show type window`,
      `set show with animation of slide show settings of presentation n to false`,
      `run slide show (slide show settings of presentation n)
      delay 2`,
    ],
    count: [`return count of slides of presentation n`],
    // 'go to slide'는 편집 창에서만 되고 슬라이드 쇼에서는 매개변수 오류(-50)가 난다. 쇼는 1번에서 시작해 하나씩 넘긴다.
    go: [`if i > 1 then go to next slide (slide show view of slide show window 1)
      delay 1`],
    close: [`exit slide show (slide show view of slide show window 1)`, `close presentation n saving no`],
    window: "new", // 슬라이드 쇼를 시작하면서 새로 생긴 창을 캡처한다
  },
  word: {
    app: "Microsoft Word",
    doc: "document",
    prepare: [
      `set view type of view of active window to page view`,
      `set page fit of zoom of view of active window to page fit full page`,
    ],
    count: [
      `return compute statistics document n statistic statistic pages`,
      `return compute statistics (text object of document n) statistic statistic pages`,
      `return 30`, // 쪽수를 못 세면 같은 화면이 다시 나올 때까지 넘긴다
    ],
    go: [
      `select (go to (text object of document n) what goto a page item which goto absolute count i)
      delay 1`,
      `select (go to document n what goto a page item which goto absolute count i)
      delay 1`,
      `if i > 1 then page scroll (active window) down 1
      delay 1`,
      `if i > 1 then page scroll of active window down 1
      delay 1`,
    ],
    close: [`close document n saving no`],
    window: "largest",
    crop: true,
  },
  excel: {
    app: "Microsoft Excel",
    doc: "workbook",
    prepare: [],
    count: [`return count of worksheets of workbook n`],
    go: [`activate object worksheet i of workbook n
      delay 1`],
    close: [`close workbook n saving no`],
    window: "largest",
  },
};
const tell = (step, body, file, i = 0) =>
  osa(["-e", `on run argv
  set n to item 1 of argv
  set i to (item 2 of argv) as integer
  tell application "${step.app}"
    ${body}
  end tell
end run`, path.basename(file), String(i)], `${step.app.replace("Microsoft ", "")} 앱에서 문서를 캡처하지 못했습니다`).catch(automationHint(step.app));
// 적힌 순서대로 처음 되는 문장의 결과
async function tellFirst(step, bodies, file, i = 0) {
  let last;
  for (const body of bodies) {
    try { return await tell(step, body, file, i); } catch (e) { last = e; }
  }
  throw last;
}
// 되는 것만 한다
async function tellEach(step, bodies, file) {
  for (const body of bodies) await tell(step, body, file).catch(() => {});
}
// 문서를 닫고, 열려 있는 다른 문서가 없으면 앱도 끈다(쓰던 문서가 있으면 그대로 둔다).
async function finish(step, file, close = step.close) {
  await tellEach(step, [...close, `if (count of every ${step.doc}) is 0 then quit`], file);
}
// 앱에서 문서가 열릴 때까지(최대 90초) 기다린다. 보호 문서는 회사 계정 확인에 시간이 걸린다.
async function openInApp(step, file) {
  await launch(step.app, file);
  for (let t = 0; t < 90; t++) {
    const opened = await tell(step, `if (name of every ${step.doc}) contains n then return "yes"
      return "no"`, file).catch(() => "no");
    if (opened === "yes") return;
    await wait(1000);
  }
  throw new Error(`${step.app}에서 문서가 열리지 않았습니다(회사 계정 로그인·보호 문서 권한 확인).`);
}
// 화면에 있는 그 앱의 창들 [{ id, area, name }] (screencapture -l에 쓸 창 번호, 넓이, 제목)
const WINDOWS = `ObjC.import("CoreGraphics");
function run([owner]) {
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))) || [];
  return JSON.stringify(all.filter((w) => w.kCGWindowOwnerName === owner && w.kCGWindowLayer === 0)
    .map((w) => ({ id: w.kCGWindowNumber, area: w.kCGWindowBounds.Width * w.kCGWindowBounds.Height, name: w.kCGWindowName || "" })));
}`;
const windows = async (app) => JSON.parse(await osa(["-l", "JavaScript", "-e", WINDOWS, app], "창을 찾지 못했습니다"));
const largest = (list) => String(list.sort((a, b) => b.area - a.area)[0]?.id ?? "");
const capture = (out, windowId) =>
  new Promise((resolve, reject) =>
    execFile("screencapture", ["-x", "-o", ...(windowId ? ["-l" + windowId] : []), out], { timeout: 30_000 }, (e) =>
      e ? reject(new Error("화면을 캡처하지 못했습니다. 시스템 설정 > 개인정보 보호 및 보안 > 화면 기록에서 터미널을 허용하세요.")) : resolve()));
// 창을 캡처한 그림(crop이면 쪽만 잘라서)
async function shot(dir, i, windowId, crop) {
  const png = path.join(dir, i + ".png");
  await capture(png, windowId);
  const image = await readFile(png);
  return crop ? cropToPage(image) : image;
}
// PowerPoint 슬라이드를 PNG로 내보낸다(화면을 쓰지 않음). Office 앱은 샌드박스라 Office 공용 폴더(Group Containers)에만
// 바로 쓸 수 있다. 내보내기가 막힌 보호 문서면 빈 목록을 돌려준다.
async function slideImages(file) {
  const dir = path.join(os.homedir(), "Library", "Group Containers", "UBF8T346G9.Office", "contest-review", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    await osa(["-e", `on run argv
  set n to item 1 of argv
  set target to (POSIX file (item 2 of argv)) as text
  tell application "Microsoft PowerPoint" to save presentation n in target as save as PNG
end run`, path.basename(file), path.join(dir, "slides")], "PowerPoint 슬라이드 내보내기");
    const names = (await readdir(dir, { recursive: true })).filter((n) => /\.png$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return await Promise.all(names.slice(0, 60).map((n) => readFile(path.join(dir, n))));
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Word 문서를 PDF로 저장해 PDFKit으로 쪽마다 읽는다(화면을 쓰지 않아 리본·눈금자 없이 쪽 전체가 나온다).
// Office 앱은 샌드박스라 Office 공용 폴더(Group Containers)에 저장한다. 보호(MIP) 문서는 저장이 막히거나
// PDF가 암호화(겉 PDF)되어 빈 목록을 돌려주고, 그때는 창 캡처로 간다. 저장한 PDF는 읽자마자 지운다.
async function wordPdfPages(file, only) {
  const dir = path.join(os.homedir(), "Library", "Group Containers", "UBF8T346G9.Office", "contest-review", randomUUID());
  await mkdir(dir, { recursive: true });
  const pdf = path.join(dir, path.basename(file, path.extname(file)) + ".pdf");
  try {
    await osa(["-e", `on run argv
  set n to item 1 of argv
  set target to (POSIX file (item 2 of argv)) as text
  tell application "Microsoft Word"
    save as document n file name target file format format PDF
    -- 버전에 따라 저장한 PDF 이름으로 바뀌면 그 문서를 닫는다(원본 이름의 문서는 finish가 닫는다)
    if (name of every document) does not contain n then close document (item 3 of argv) saving no
  end tell
end run`, path.basename(file), pdf, path.basename(pdf)], "Word에서 PDF로 저장");
    if (await wrapped(pdf)) return [];
    return await pdfKitPages(pdf, only);
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 앱이 없으면 AppleScript가 '앱 찾기' 창을 띄우므로 먼저 확인한다.
export const installed = (app) => new Promise((resolve) => execFile("open", ["-Ra", app], (e) => resolve(!e)));

// 터미널(서버를 띄운 앱)에 화면 기록·손쉬운 사용 권한이 있는가. 묻는 창은 띄우지 않는다. 확인하지 못하면 null.
// 새 함수는 JXA가 미리 알지 못해 bindFunction으로 형식(bool 반환, 인자 없음)을 알려 준다.
export async function macPermissions() {
  const ask = (framework, call) =>
    osa(["-l", "JavaScript", "-e", `ObjC.import("${framework}"); ObjC.bindFunction("${call}", ["bool", []]); String($.${call}())`], "권한 확인")
      .then((v) => v === "true", () => null);
  return { screen: await ask("CoreGraphics", "CGPreflightScreenCaptureAccess"), accessibility: await ask("ApplicationServices", "AXIsProcessTrusted") };
}

// 보호(MIP) PDF는 PDFKit이 열지 못한다. 회사 계정으로 로그인한 Microsoft Edge로 열고, Edge가 없으면 Adobe Acrobat Reader로 연다.
// 보호를 푸는 것이 아니라 그 앱이 허락하는 기능(저장·화면 표시)만 쓴다. 문서 권한이 막으면 읽지 못한다.
const EDGE = "Microsoft Edge";
const READERS = ["Adobe Acrobat Reader", "Adobe Acrobat Reader DC", "Adobe Acrobat"];
async function protectedPdf(file, only, options) {
  if (await installed(EDGE)) return edgePages(file, only, options);
  for (const app of READERS) if (await installed(app)) {
    options.how = app + " 화면 캡처";
    return readerCaptures(app, file, only);
  }
  throw new Error("보호된 PDF라 Microsoft Edge(회사 계정 로그인)로 열어 캡처해야 하는데 이 맥에 Edge가 없습니다. Edge를 설치한 뒤 목록의 '지금 가져오기'를 누르세요.");
}

// Edge의 '다른 이름으로 저장'(⌘S)으로 사본을 임시 폴더에 받는다. 저장 창에서 ⇧⌘G(폴더로 이동)에 폴더 경로를 붙여 넣는다
// (한글 입력 상태에서도 되게 클립보드를 쓰고 되돌린다). 키는 자판 배열과 무관한 키 코드로 보낸다: 1 S · 5 G · 0 A · 9 V · 36 Return · 53 Esc
const SAVE_AS = `on check()
  tell application "System Events"
    if not (frontmost of process "${EDGE}") then error "다른 앱이 앞으로 나와 저장을 멈췄습니다"
  end tell
end check
on run argv
  set w to (item 1 of argv) as integer
  tell application "${EDGE}"
    set index of window id w to 1
    activate
  end tell
  delay 0.5
  try
    set kept to the clipboard
  on error
    set kept to ""
  end try
  set the clipboard to (item 2 of argv)
  try
    tell application "System Events" to tell process "${EDGE}"
      my check()
      key code 1 using command down
      repeat 20 times
        if exists sheet 1 of window 1 then exit repeat
        delay 0.5
      end repeat
      if not (exists sheet 1 of window 1) then error "저장 창이 뜨지 않았습니다"
      my check()
      key code 5 using {command down, shift down}
      delay 1
      my check()
      key code 0 using command down
      key code 9 using command down
      delay 1
      my check()
      key code 36
      delay 1.5
      my check()
      key code 36
      delay 1.5
      repeat 3 times
        if not (exists sheet 1 of window 1) then exit repeat
        my check()
        key code 53
        delay 0.5
      end repeat
    end tell
  on error m
    set the clipboard to kept
    error m
  end try
  set the clipboard to kept
end run`;
// 그 사본을 PDFKit으로 읽은 쪽들. 저장 권한이 있는 문서는 사본이 보호 없이 저장되어 원본 화질로 나온다. 사본은 읽자마자 지운다.
// 터미널에 '손쉬운 사용'(키 입력) 권한이 필요하다. 키는 Edge가 맨 앞일 때만 보낸다(다른 앱에 ⌘V·Return이 들어가지 않게).
// 저장이 안 되거나 사본도 보호되어 있으면(안내 쪽만 보이는 겉 PDF 포함) 까닭을 던진다.
async function edgeSaved(windowId, only) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "edge-save-"));
  try {
    await osa(["-e", SAVE_AS, String(windowId), dir], "Edge에서 다른 이름으로 저장하지 못했습니다").catch(accessibilityHint);
    for (let t = 0; t < 20; t++) {
      const name = (await readdir(dir)).find((n) => /\.pdf$/i.test(n));
      if (name) {
        await wait(1500); // 다 써질 때까지
        const copy = path.join(dir, name);
        const pages = (await wrapped(copy)) ? null : await pdfKitPages(copy, only).catch(() => null);
        if (!pages) throw new Error("저장한 사본도 보호되어 있어 열 수 없습니다");
        return pages;
      }
      await wait(500);
    }
    throw new Error("저장한 사본을 찾지 못했습니다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Edge: 따로 새 창을 열어 PDF를 연다. 먼저 '다른 이름으로 저장'한 사본을 읽어 보고(edgeSaved), 안 되면 쪽 번호
// (#page=N&view=FitV: 쪽 높이를 창에 맞춤)로 열어 그 창을 캡처한 뒤 쪽만 잘라 낸다(도구 막대도 잘려 나간다).
// (실측: 윈도우 Edge는 view=Fit·toolbar=0을 따르지 않아 쪽 아래가 잘렸고 FitV는 따랐다. 같은 뷰어라 맥도 FitV를 쓴다.)
// 창은 가로로 넓게 두어(화면 높이의 90% × 2.1배) 가로 슬라이드도 옆에 여백이 남게 한다(그래야 쪽 경계를 찾는다).
// 쓰던 Edge 창·탭은 건드리지 않고, 끝나면 그 창만 닫는다(원래 Edge가 꺼져 있었으면 Edge도 끈다).
// 캡처할 때는 쪽마다 빈 화면을 거쳐 새로 열어 그 쪽에서 시작하게 한다.
// 쪽 수는 알 수 없어 넘기다 같은 화면이 다시 나오면 마지막 쪽으로 본다. 터미널에 Edge 제어(자동화)와 화면 기록 권한이 필요하다.
async function edgePages(file, only, options) {
  const url = pathToFileURL(file).href;
  const edge = (body, windowId = 0, page = 0) =>
    osa(["-e", `on run argv
  set u to item 1 of argv
  set w to (item 2 of argv) as integer
  set p to item 3 of argv
  tell application "${EDGE}"
    ${body}
  end tell
end run`, url, String(windowId), String(page)], "Edge에서 PDF를 열지 못했습니다").catch(automationHint(EDGE));
  // 다 읽어 들일 때까지(최대 seconds초) 기다리고 그림이 그려질 시간을 조금 더 준다
  const loaded = async (windowId, seconds) => {
    for (let t = 0; t < seconds; t++) {
      if ((await edge(`return (loading of active tab of window id w) as text`, windowId).catch(() => "true")) === "false") break;
      await wait(1000);
    }
    await wait(2500);
  };
  const open = (windowId, page) => edge(`set URL of active tab of window id w to "about:blank"
    delay 0.3
    set URL of active tab of window id w to u & "#page=" & p & "&view=FitV"
    set index of window id w to 1
    activate`, windowId, page);
  const before = await windows(EDGE).catch(() => []);
  const windowId = Number(await edge(`set nw to make new window
    return id of nw`));
  const [screenW, screenH] = await osa(["-l", "JavaScript", "-e",
    `ObjC.import("AppKit"); const f = $.NSScreen.mainScreen.visibleFrame; JSON.stringify([f.size.width, f.size.height])`], "화면 크기")
    .then(JSON.parse).catch(() => [1440, 900]);
  const height = Math.round(screenH * 0.9), width = Math.min(Math.round(screenW) - 20, Math.round(height * 2.1));
  await edge(`set bounds of window id w to {10, 40, ${10 + width}, ${40 + height}}`, windowId).catch(() => {});
  const out = await mkdtemp(path.join(os.tmpdir(), "edge-"));
  const pages = [];
  try {
    await open(windowId, only || 1);
    await loaded(windowId, 90); // 보호 문서는 회사 계정 확인에 시간이 걸린다
    let why = "";
    const saved = await edgeSaved(windowId, only).catch((e) => void (why = e.message));
    options.how = saved?.length ? "Edge에서 다른 이름으로 저장" : `Edge 화면 캡처(저장 안 됨: ${why})`;
    if (saved?.length) return saved;
    if (why.includes("다른 앱이 앞으로")) throw new Error(why + ". 목록의 '지금 가져오기'로 다시 읽으세요."); // 저장 창이 남았을 수 있어 캡처하지 않는다
    let shotId = "";
    for (let t = 0; t < 10 && !shotId; t++) {
      shotId = largest((await windows(EDGE)).filter((w) => !before.some((b) => b.id === w.id)));
      if (!shotId) await wait(500);
    }
    for (let i = only || 1; i <= (only || 60); i++) {
      if (i > (only || 1)) {
        await open(windowId, i);
        await loaded(windowId, 30);
      }
      const page = await shot(out, i, shotId, true);
      if (!pages.length && (await blank(page)))
        throw new Error(`Edge가 이 보호 문서의 화면 캡처를 막았고, '다른 이름으로 저장'도 되지 않았습니다(${why}).`);
      if (pages.length && (await samePage(page, pages.at(-1)))) break; // 더 넘어가지 않는다(마지막 쪽)
      pages.push(page);
    }
    return pages;
  } finally {
    await edge(`close window id w`, windowId).catch(() => {});
    if (!before.length) await edge(`quit`).catch(() => {});
    await rm(out, { recursive: true, force: true });
  }
}

// Acrobat Reader: 창을 쪽마다 캡처한다. Reader는 AppleScript로 쪽을 넘기지 못해 키보드로 넘긴다
// (앞으로 가져와 ⌘0 페이지 맞춤 → Home 첫 쪽 → → 다음 쪽). 같은 화면이 다시 나오면 마지막 쪽이다.
// 서버를 띄운 터미널에 '화면 기록'과 '손쉬운 사용'(키 입력) 권한이 있어야 한다.
async function readerCaptures(app, file, only) {
  const keys = (lines) =>
    osa(["-e", `tell application "${app}" to activate
delay 0.5
tell application "System Events"
  ${lines}
end tell`], "Acrobat Reader에서 쪽을 넘기지 못했습니다").catch(accessibilityHint);
  const before = new Set((await windows(app).catch(() => [])).map((w) => w.id));
  await launch(app, file);
  // 그 문서 창이 뜰 때까지(최대 90초) 기다린다. 제목에 파일 이름이 있거나 새로 생긴 창
  const title = path.basename(file, path.extname(file));
  let windowId = "";
  for (let t = 0; t < 90 && !windowId; t++) {
    const now = await windows(app).catch(() => []);
    windowId = largest(now.filter((w) => w.name.includes(title) || !before.has(w.id)));
    if (!windowId) await wait(1000);
  }
  if (!windowId) throw new Error("Acrobat Reader에서 문서가 열리지 않았습니다(회사 계정 로그인·보호 문서 권한 확인).");
  const out = await mkdtemp(path.join(os.tmpdir(), "reader-"));
  const pages = [];
  try {
    await keys(`keystroke "0" using command down
  delay 1
  key code 115
  delay 1`);
    for (let i = 1; i <= (only || 150); i++) {
      if (i > 1) await keys(`key code 124
  delay 1`);
      if (only && i < only) continue;
      const page = await shot(out, i, windowId, true);
      if (pages.length && (await samePage(page, pages.at(-1)))) break; // 더 넘어가지 않는다(마지막 쪽)
      pages.push(page);
    }
    return pages;
  } finally {
    // 그 문서만 닫고(⌘W), 남은 창이 없으면 Reader도 끈다
    await keys(`keystroke "w" using command down`).catch(() => {});
    await wait(1000);
    if (!(await windows(app).catch(() => [])).length) await osa(["-e", `tell application "${app}" to quit`], "").catch(() => {});
    await rm(out, { recursive: true, force: true });
  }
}
async function officeCaptures(kind, file, only) {
  const step = STEPS[kind];
  if (!(await installed(step.app))) throw new Error(`이 맥에 ${step.app} 앱이 없습니다. 회사 뷰어로 열어 캡처해 올려 주세요.`);
  await openInApp(step, file);
  if (kind === "word") {
    const pages = await wordPdfPages(file, only); // 저장이 막힌 보호 문서는 창 캡처
    if (pages.length) {
      await finish(step, file);
      return pages;
    }
  }
  if (kind === "powerpoint") {
    const slides = await slideImages(file); // 내보내기가 막힌 보호 문서는 슬라이드 쇼로 캡처
    if (slides.length) {
      await finish(step, file, step.close.slice(-1));
      return only ? slides.slice(only - 1, only) : slides;
    }
  }
  const out = await mkdtemp(path.join(os.tmpdir(), "office-"));
  const pages = [];
  try {
    const before = new Set((await windows(step.app)).map((w) => w.id));
    await tellEach(step, step.prepare, file);
    const count = Math.min(Number(await tellFirst(step, step.count, file)) || 0, 60);
    const now = await windows(step.app);
    // 그 창만 캡처한다(다른 창에 가려져도 된다). 새 창을 못 찾으면(쇼가 전체 화면으로 뜬 경우) 화면 전체를 캡처한다.
    const windowId = largest(step.window === "new" ? now.filter((w) => !before.has(w.id)) : now);
    // 한 쪽만(only) 받을 때: 슬라이드 쇼는 1번부터 넘겨야 하고, Word·Excel은 그 쪽으로 바로 간다.
    const first = only && kind !== "powerpoint" ? only : 1;
    for (let i = first; i <= (only || count); i++) {
      try {
        await tellFirst(step, step.go, file, i);
      } catch (e) {
        if (!pages.length) throw e;
        break; // 숨긴 슬라이드 등으로 쇼가 먼저 끝났다: 받은 데까지 쓴다
      }
      if (only && i < only) continue;
      const page = await shot(out, i, windowId, step.crop);
      if (pages.length && (await samePage(page, pages.at(-1)))) break; // 더 넘어가지 않는다(마지막 쪽)
      pages.push(page);
    }
    if (!pages.length) throw new Error("문서에서 캡처할 쪽을 찾지 못했습니다.");
    return pages;
  } finally {
    await finish(step, file);
    await rm(out, { recursive: true, force: true });
  }
}

// 문서(kind: pdf·word·powerpoint·excel)의 쪽 그림들. attachment-pages.mjs가 부른다.
export const documentPages = (kind, file, only, options) => (kind === "pdf" ? pdfPages(file, only, options) : officeCaptures(kind, file, only));
