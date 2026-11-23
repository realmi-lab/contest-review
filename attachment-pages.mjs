// MS Forms 첨부를 캡처(쪽 이미지)로 바꾼다. 문서는 맥에서만 바꾼다.
//   그림(PNG·JPG·WebP): 그대로 한 장
//   PDF: 맥 PDFKit으로 쪽마다 PNG
//   Word·PowerPoint·Excel: 맥의 Office 앱이 회사 계정으로 열어(MIP 보호 문서 포함) 쪽마다 화면 캡처
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

const IMAGES = ["png", "jpg", "jpeg", "webp"];
const OFFICE = {
  doc: "word", docx: "word", ppt: "powerpoint", pptx: "powerpoint", xls: "excel", xlsx: "excel",
};
export const pageKind = (name) => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return IMAGES.includes(ext) ? "image" : ext === "pdf" ? "pdf" : OFFICE[ext] ?? "";
};

const osa = (args, what) =>
  new Promise((resolve, reject) =>
    execFile("osascript", args, { timeout: 300_000, maxBuffer: 8 << 20 }, (e, out, errText) =>
      e ? reject(new Error(`${what}: ${String(errText || e.message).trim()}`)) : resolve(out.trim())));

// PDF 쪽마다 긴 변 1600px PNG (흰 바탕은 캡처 접수 때 깐다)
const PDF_PAGES = `ObjC.import("PDFKit"); ObjC.import("AppKit");
function run([pdf, out, only]) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(pdf));
  if (!doc || doc.isNil() || doc.isLocked) throw new Error("열 수 없는 PDF(암호·보호 문서)");
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
async function pdfPages(pdf, only) {
  const out = await mkdtemp(path.join(os.tmpdir(), "pages-"));
  try {
    await osa(["-l", "JavaScript", "-e", PDF_PAGES, pdf, out, String(only || "")], "PDF").catch(() => {
      throw new Error("열 수 없는 PDF입니다(암호·보호 문서). 회사 뷰어로 열어 캡처해 올려 주세요.");
    });
    const names = (await readdir(out)).filter((n) => n.endsWith(".png")).sort();
    return Promise.all(names.map((n) => readFile(path.join(out, n))));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

// Office 문서: 앱으로 열어 쪽(슬라이드·시트)마다 받는다. MIP로 보호된 문서는 PDF로 내보내도 암호화되어
// 읽을 수 없으므로, PowerPoint는 슬라이드를 PNG로 내보내고(화면을 쓰지 않음, 막혀 있으면 창 모드 슬라이드 쇼 캡처),
// Word는 '한 쪽 전체' 배율로, Excel은 시트마다 창을 캡처한다. 창은 앞으로 가져오지 않는다(가려져도 창 번호로 캡처).
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
end run`, path.basename(file), String(i)], `${step.app.replace("Microsoft ", "")} 앱에서 문서를 캡처하지 못했습니다`).catch((e) => {
    // -1743: macOS가 터미널의 앱 제어를 막았다
    throw /-1743/.test(e.message) ? new Error(`터미널이 ${step.app}를 제어할 수 없습니다. 시스템 설정 > 개인정보 보호 및 보안 > 자동화에서 허용하세요.`) : e;
  });
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
  await new Promise((resolve, reject) =>
    execFile("open", ["-g", "-a", step.app, file], (e) => (e ? reject(new Error(`${step.app}로 문서를 열지 못했습니다.`)) : resolve())));
  for (let t = 0; t < 90; t++) {
    const opened = await tell(step, `if (name of every ${step.doc}) contains n then return "yes"
      return "no"`, file).catch(() => "no");
    if (opened === "yes") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${step.app}에서 문서가 열리지 않았습니다(회사 계정 로그인·보호 문서 권한 확인).`);
}
// 화면에 있는 그 앱의 창들 [{ id, area }] (screencapture -l에 쓸 창 번호와 넓이)
const WINDOWS = `ObjC.import("CoreGraphics");
function run([owner]) {
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))) || [];
  return JSON.stringify(all.filter((w) => w.kCGWindowOwnerName === owner && w.kCGWindowLayer === 0)
    .map((w) => ({ id: w.kCGWindowNumber, area: w.kCGWindowBounds.Width * w.kCGWindowBounds.Height })));
}`;
const windows = async (app) => JSON.parse(await osa(["-l", "JavaScript", "-e", WINDOWS, app], "창을 찾지 못했습니다"));
const largest = (list) => String(list.sort((a, b) => b.area - a.area)[0]?.id ?? "");
const capture = (out, windowId) =>
  new Promise((resolve, reject) =>
    execFile("screencapture", ["-x", "-o", ...(windowId ? ["-l" + windowId] : []), out], { timeout: 30_000 }, (e) =>
      e ? reject(new Error("화면을 캡처하지 못했습니다. 시스템 설정 > 개인정보 보호 및 보안 > 화면 기록에서 터미널을 허용하세요.")) : resolve()));
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

// 앱이 없으면 AppleScript가 '앱 찾기' 창을 띄우므로 먼저 확인한다.
const installed = (app) => new Promise((resolve) => execFile("open", ["-Ra", app], (e) => resolve(!e)));
async function officeCaptures(kind, file, only) {
  const step = STEPS[kind];
  if (!(await installed(step.app))) throw new Error(`이 맥에 ${step.app} 앱이 없습니다. 회사 뷰어로 열어 캡처해 올려 주세요.`);
  await openInApp(step, file);
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
      const png = path.join(out, i + ".png");
      await capture(png, windowId);
      const page = await readFile(png);
      if (pages.length && page.equals(pages.at(-1))) break; // 더 넘어가지 않는다(마지막 쪽)
      pages.push(page);
    }
    if (!pages.length) throw new Error("문서에서 캡처할 쪽을 찾지 못했습니다.");
    return pages;
  } finally {
    await finish(step, file);
    await rm(out, { recursive: true, force: true });
  }
}

// 문서의 쪽 이미지들. only(1부터)를 주면 그 쪽 한 장만 돌려준다(다시 캡처).
export async function attachmentPages(file, only) {
  const kind = pageKind(file);
  if (!kind) throw new Error("자동으로 읽지 않는 형식입니다. 회사 뷰어로 열어 캡처해 올려 주세요.");
  if (kind === "image") return [await readFile(file)];
  if (process.platform !== "darwin") throw new Error("문서를 쪽 이미지로 바꾸는 기능은 맥에서만 동작합니다. 화면을 캡처해 올려 주세요.");
  const pages = await (kind === "pdf" ? pdfPages(file, only) : officeCaptures(kind, file, only));
  if (only && !pages.length) throw new Error(only + "쪽을 문서에서 찾지 못했습니다.");
  return pages;
}
