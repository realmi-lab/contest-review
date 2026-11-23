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
const STEPS = {
  powerpoint: {
    app: "Microsoft PowerPoint",
    open: `activate
      open f
      delay 2
      set p to active presentation
      run slide show (slide show settings of p)
      delay 2
      return count of slides of p`,
    go: `go to slide (slide show view of slide show window 1) number i
      delay 1`,
    close: `exit slide show (slide show view of slide show window 1)
      close active presentation saving no`,
    window: false,
  },
  word: {
    app: "Microsoft Word",
    open: `open f
      delay 2
      set view type of view of active window to print view
      set page fit of zoom of view of active window to page fit full page
      return compute statistics active document statistic statistic pages`,
    go: `select (go to active document what go to a page which go to absolute count i)
      delay 1`,
    close: `close active document saving no`,
    window: true,
  },
  excel: {
    app: "Microsoft Excel",
    open: `open f
      delay 2
      return count of worksheets of active workbook`,
    go: `activate object worksheet i of active workbook
      select range "A1" of active sheet
      delay 1`,
    close: `close active workbook saving no`,
    window: true,
  },
};
const tell = (step, body, file, i = 0) =>
  osa(["-e", `on run argv
  set f to POSIX file (item 1 of argv)
  set i to (item 2 of argv) as integer
  tell application "${step.app}"
    ${body}
  end tell
end run`, file, String(i)], `${step.app.replace("Microsoft ", "")} 앱으로 문서를 열어 캡처하지 못했습니다(Office 로그인·'제어 허용' 확인)`);
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
// PowerPoint 슬라이드를 PNG로 내보낸다. Office 앱은 샌드박스라 Office 공용 폴더(Group Containers)에만 바로 쓸 수 있다.
async function slideImages(file) {
  const dir = path.join(os.homedir(), "Library", "Group Containers", "UBF8T346G9.Office", "contest-review", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    await osa(["-e", `on run argv
  set f to POSIX file (item 1 of argv)
  set target to (POSIX file (item 2 of argv)) as text
  tell application "Microsoft PowerPoint"
    open f
    set p to active presentation
    save p in target as save as PNG
    close p saving no
  end tell
end run`, file, path.join(dir, "slides")], "PowerPoint 슬라이드 내보내기");
    const names = (await readdir(dir, { recursive: true })).filter((n) => /\.png$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return await Promise.all(names.slice(0, 60).map((n) => readFile(path.join(dir, n))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 앱이 없으면 AppleScript가 '앱 찾기' 창을 띄우므로 먼저 확인한다.
const installed = (app) => new Promise((resolve) => execFile("open", ["-Ra", app], (e) => resolve(!e)));
async function officeCaptures(kind, file) {
  const step = STEPS[kind];
  if (!(await installed(step.app))) throw new Error(`이 맥에 ${step.app} 앱이 없습니다. 회사 뷰어로 열어 캡처해 올려 주세요.`);
  if (kind === "powerpoint") {
    const slides = await slideImages(file).catch(() => []); // 내보내기가 막힌 보호 문서는 슬라이드 쇼로 캡처
    if (slides.length) return slides;
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
