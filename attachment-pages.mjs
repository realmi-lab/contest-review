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
function run([pdf, out]) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(pdf));
  if (!doc || doc.isNil() || doc.isLocked) throw new Error("열 수 없는 PDF(암호·보호 문서)");
  const n = Math.min(doc.pageCount, 150);
  for (let i = 0; i < n; i++) {
    const page = doc.pageAtIndex(i), box = page.boundsForBox(0).size;
    const scale = 1600 / Math.max(box.width, box.height);
    const image = page.thumbnailOfSizeForBox($.NSMakeSize(box.width * scale, box.height * scale), 0);
    const png = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation).representationUsingTypeProperties(4, $());
    png.writeToFileAtomically(out + "/" + String(i + 1).padStart(3, "0") + ".png", true);
  }
  return String(n);
}`;
async function pdfPages(pdf) {
  const out = await mkdtemp(path.join(os.tmpdir(), "pages-"));
  try {
    await osa(["-l", "JavaScript", "-e", PDF_PAGES, pdf, out], "PDF").catch(() => {
      throw new Error("열 수 없는 PDF입니다(암호·보호 문서). 회사 뷰어로 열어 캡처해 올려 주세요.");
    });
    const names = (await readdir(out)).filter((n) => n.endsWith(".png")).sort();
    return Promise.all(names.map((n) => readFile(path.join(out, n))));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

// Office 문서: 앱으로 열어 쪽(슬라이드·시트)마다 받는다. MIP로 보호된 문서는 PDF로 내보내도 암호화되어
// 읽을 수 없으므로, PowerPoint는 슬라이드를 PNG로 내보내고(화면을 쓰지 않음, 막혀 있으면 슬라이드 쇼 캡처),
// Word는 '한 쪽 전체' 배율로, Excel은 시트마다 창을 캡처한다. 창은 앞으로 가져오지 않는다(가려져도 창 번호로 캡처).
// 이 서버를 띄운 터미널에 Office '제어'와 '화면 기록' 권한이 있어야 한다.
// 문서는 Launch Services(open -g -a)로 연다: Office 샌드박스가 파일 접근을 허락받고, 앱을 앞으로 가져오지 않는다.
// (AppleScript의 open은 OneDrive 폴더 문서에서 '매개변수 오류(-50)'를 냈다.) 그 뒤로는 문서 이름(n)으로 다룬다.
const STEPS = {
  powerpoint: {
    app: "Microsoft PowerPoint",
    doc: "presentation",
    open: `run slide show (slide show settings of presentation n)
      delay 2
      return count of slides of presentation n`,
    go: `go to slide (slide show view of slide show window 1) number i
      delay 1`,
    close: `exit slide show (slide show view of slide show window 1)
      close presentation n saving no`,
    window: false,
  },
  word: {
    app: "Microsoft Word",
    doc: "document",
    open: `set view type of view of active window to print view
      set page fit of zoom of view of active window to page fit full page
      return compute statistics document n statistic statistic pages`,
    go: `select (go to document n what go to a page which go to absolute count i)
      delay 1`,
    close: `close document n saving no`,
    window: true,
  },
  excel: {
    app: "Microsoft Excel",
    doc: "workbook",
    open: `return count of worksheets of workbook n`,
    go: `activate object worksheet i of workbook n
      delay 1`,
    close: `close workbook n saving no`,
    window: true,
  },
};
const tell = (step, body, file, i = 0) =>
  osa(["-e", `on run argv
  set n to item 1 of argv
  set i to (item 2 of argv) as integer
  tell application "${step.app}"
    ${body}
  end tell
end run`, path.basename(file), String(i)], `${step.app.replace("Microsoft ", "")} 앱으로 문서를 열어 캡처하지 못했습니다(Office 로그인·'제어 허용' 확인)`);
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
// 화면에 보이는 그 앱의 가장 큰 창 번호(screencapture -l)
const WINDOW_ID = `ObjC.import("CoreGraphics");
function run([owner]) {
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))) || [];
  const area = (w) => w.kCGWindowBounds.Width * w.kCGWindowBounds.Height;
  const mine = all.filter((w) => w.kCGWindowOwnerName === owner && w.kCGWindowLayer === 0).sort((a, b) => area(b) - area(a));
  return mine.length ? String(mine[0].kCGWindowNumber) : "";
}`;
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
async function officeCaptures(kind, file) {
  const step = STEPS[kind];
  if (!(await installed(step.app))) throw new Error(`이 맥에 ${step.app} 앱이 없습니다. 회사 뷰어로 열어 캡처해 올려 주세요.`);
  await openInApp(step, file);
  if (kind === "powerpoint") {
    const slides = await slideImages(file); // 내보내기가 막힌 보호 문서는 슬라이드 쇼로 캡처
    if (slides.length) {
      await tell(step, step.close.split("\n").pop(), file).catch(() => {});
      return slides;
    }
  }
  const out = await mkdtemp(path.join(os.tmpdir(), "office-"));
  try {
    const count = Math.min(Number(await tell(step, step.open, file)) || 0, 60);
    const windowId = step.window ? await osa(["-l", "JavaScript", "-e", WINDOW_ID, step.app], "창을 찾지 못했습니다") : "";
    const pages = [];
    try {
      for (let i = 1; i <= count; i++) {
        await tell(step, step.go, file, i);
        const png = path.join(out, i + ".png");
        await capture(png, windowId);
        pages.push(await readFile(png));
      }
    } finally {
      await tell(step, step.close, file).catch(() => {});
    }
    if (!pages.length) throw new Error("문서에서 캡처할 쪽을 찾지 못했습니다.");
    return pages;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

export async function attachmentPages(file) {
  const kind = pageKind(file);
  if (!kind) throw new Error("자동으로 읽지 않는 형식입니다. 회사 뷰어로 열어 캡처해 올려 주세요.");
  if (kind === "image") return [await readFile(file)];
  if (process.platform !== "darwin") throw new Error("문서를 쪽 이미지로 바꾸는 기능은 맥에서만 동작합니다.");
  return kind === "pdf" ? pdfPages(file) : officeCaptures(kind, file);
}
