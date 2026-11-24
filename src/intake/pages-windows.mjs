// 윈도우에서 첨부 문서를 쪽 그림으로 바꾼다. 사람이 함께 쓰는 업무 PC라 앱 창을 화면에 띄우지 않는다.
//   PDF: Windows 기본 PDF 기능(Windows.Data.Pdf, PowerShell)으로 쪽마다 PNG
//   Word·PowerPoint·Excel: Office 앱을 창 없이 열어(회사 계정, COM) PDF로 내보낸 뒤 PDF와 같이 바꾼다.
//     보호(MIP) 문서는 내보낸 PDF도 보호되므로 아래 보호 PDF 길로 간다. 문서 권한이 내보내기를 막으면 읽지 못한다.
//   보호 PDF(MS Forms 첨부는 모두 보호 문서로 본다): 이 앱 전용 Edge 프로필을 화면 밖 창으로 열어
//     DevTools 프로토콜(파이프)로 쪽마다 화면을 받아 쪽만 잘라 낸다. 처음 한 번 그 프로필에 회사 계정으로 로그인해야 한다
//     (deploy/edge-login.bat).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appDir } from "../app-dir.mjs";
import { blank, cropToPage, samePage, wait, wrapped } from "./page-images.mjs";
import { powershell } from "./scripting.mjs";

// ── PDF → PNG (Windows.Data.Pdf). 쪽 너비의 2배(약 192dpi)로 그린다. CR_ONLY가 쪽 수보다 크면 0쪽.
const PDF_PAGES = `Add-Type -AssemblyName System.Runtime.WindowsRuntime
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$asOperation = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
$asAction = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Await($operation, [Type]$type) { $task = $asOperation.MakeGenericMethod($type).Invoke($null, @($operation)); [void]$task.Wait(-1); $task.Result }
function AwaitAction($action) { [void]$asAction.Invoke($null, @($action)).Wait(-1) }
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
[void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
[void][Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:CR_FILE)) ([Windows.Storage.StorageFile])
$doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($env:CR_OUT)) ([Windows.Storage.StorageFolder])
$only = [int]$env:CR_ONLY
if ($only -gt $doc.PageCount) { '0'; exit 0 }
$first = if ($only) { $only - 1 } else { 0 }
$last = if ($only) { $only - 1 } else { [Math]::Min($doc.PageCount, 150) - 1 }
for ($i = $first; $i -le $last; $i++) {
  $page = $doc.GetPage($i)
  $name = '{0:D3}.png' -f ($i + 1)
  $target = Await ($folder.CreateFileAsync($name, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $stream = Await ($target.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
  $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $options.DestinationWidth = [uint32][Math]::Round($page.Size.Width * 2)
  AwaitAction ($page.RenderToStreamAsync($stream, $options))
  $stream.Dispose(); $page.Dispose()
}
$doc.PageCount`;

async function renderPdf(pdf, only) {
  const out = await mkdtemp(path.join(os.tmpdir(), "pages-"));
  try {
    await powershell(PDF_PAGES, { CR_FILE: pdf, CR_OUT: out, CR_ONLY: String(only || 0) }, "PDF");
    const names = (await readdir(out)).filter((n) => n.endsWith(".png")).sort();
    return await Promise.all(names.map((n) => readFile(path.join(out, n))));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

// ── Office → PDF (COM). Word·Excel은 따로 띄운 창 없는 앱을 쓰고 끝나면 끈다. PowerPoint는 앱이 하나뿐이라 창 없이 열고,
//    원래 꺼져 있었을 때만 끈다(쓰던 발표 자료는 건드리지 않는다). 매크로는 실행하지 않는다.
const OFFICE_PDF = {
  word: `$app = New-Object -ComObject Word.Application
try {
  $app.DisplayAlerts = 0; $app.AutomationSecurity = 3
  $doc = $app.Documents.Open($env:CR_FILE, $false, $true, $false)
  try { $doc.ExportAsFixedFormat($env:CR_PDF, 17) } finally { $doc.Close(0) }
} finally { if ($app.Documents.Count -eq 0) { $app.Quit() } }`,
  excel: `$app = New-Object -ComObject Excel.Application
try {
  $app.DisplayAlerts = $false; $app.AutomationSecurity = 3
  $book = $app.Workbooks.Open($env:CR_FILE, 0, $true)
  try { $book.ExportAsFixedFormat(0, $env:CR_PDF) } finally { $book.Close($false) }
} finally { if ($app.Workbooks.Count -eq 0) { $app.Quit() } }`,
  powerpoint: `$running = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
$app = New-Object -ComObject PowerPoint.Application
try {
  $app.AutomationSecurity = 3
  $deck = $app.Presentations.Open($env:CR_FILE, -1, 0, 0)
  try { $deck.SaveAs($env:CR_PDF, 32) } finally { $deck.Close() }
} finally { if (-not $running -and $app.Presentations.Count -eq 0) { $app.Quit() } }`,
};
export const WINDOWS_SCRIPTS = { PDF_PAGES, ...OFFICE_PDF }; // 윈도우 점검(tests)에서 문법을 확인한다

const APPS = { word: "Word", excel: "Excel", powerpoint: "PowerPoint" };
async function officePdf(kind, file, pdf) {
  await powershell(OFFICE_PDF[kind], { CR_FILE: file, CR_PDF: pdf }, `${APPS[kind]} 앱에서 PDF로 내보내지 못했습니다(Office 설치·회사 계정 로그인·문서 권한 확인)`);
  if (!existsSync(pdf)) throw new Error(`${APPS[kind]} 앱이 PDF를 만들지 못했습니다(문서 권한이 내보내기를 막았을 수 있습니다).`);
}

// ── 보호 PDF: 이 앱 전용 Edge 프로필(회사 계정 로그인이 남는다)
export const edgeExe = () =>
  [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((dir) => path.join(dir, "Microsoft", "Edge", "Application", "msedge.exe"))
    .find(existsSync);
export const edgeProfile = () => process.env.REVIEW_EDGE_PROFILE || path.join(appDir("ContestReviewDesk"), "edge-profile");

// Edge와 주고받는 DevTools 프로토콜(파이프: Edge가 3번으로 받고 4번으로 보낸다. 글 끝은 \0)
export function devtools(edge) {
  const [, , , input, output] = edge.stdio;
  const waiting = new Map();
  let id = 0, buffer = "";
  const failAll = (message) => {
    for (const { reject } of waiting.values()) reject(new Error(message));
    waiting.clear();
  };
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf("\0")) >= 0; buffer = buffer.slice(end + 1)) {
      const message = JSON.parse(buffer.slice(0, end));
      const call = waiting.get(message.id);
      if (!call) continue; // 알림(event)은 쓰지 않는다
      waiting.delete(message.id);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
    }
  });
  // 같은 프로필의 Edge(edge-login.bat으로 연 창)가 이미 떠 있으면 새 Edge는 그 창에 넘기고 바로 꺼진다
  edge.on("exit", () => failAll("Edge가 꺼졌습니다. edge-login.bat으로 연 Edge 창이 있으면 닫고 다시 시도하세요"));
  // 30초 안에 답이 없으면(회사 정책이 원격 디버깅을 막았거나 Edge가 멈춤) 실패
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const mine = ++id;
      const timer = setTimeout(() => {
        waiting.delete(mine);
        reject(new Error("Edge가 답하지 않습니다(회사 정책이 원격 디버깅을 막았을 수 있습니다)"));
      }, 30_000);
      waiting.set(mine, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
      input.write(JSON.stringify({ id: mine, method, params, ...(sessionId && { sessionId }) }) + "\0");
    });
}

// 쪽 번호(#page=N, 쪽 맞춤, 뷰어 도구 막대 숨김)로 열고, 다 읽은 뒤 화면이 두 번 연달아 같으면(최대 seconds초) 캡처해 쪽만 잘라 낸다.
// 쪽 수는 알 수 없어 넘기다 같은 화면이 다시 나오면 마지막 쪽으로 본다.
async function edgePages(file, only, options) {
  const exe = edgeExe();
  if (!exe) throw new Error("보호된 PDF라 Microsoft Edge(회사 계정)로 열어야 하는데 이 PC에 Edge가 없습니다.");
  const edge = spawn(exe, [
    `--user-data-dir=${edgeProfile()}`, "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check",
    "--window-position=-32000,-32000", "--window-size=1600,1100", // 화면 밖에 둔다
    "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const send = devtools(edge);
  try {
    let tab;
    for (let t = 0; t < 20 && !tab; t++) {
      tab = (await send("Target.getTargets")).targetInfos.find((target) => target.type === "page");
      if (!tab) await wait(500);
    }
    if (!tab) throw new Error("Edge 창을 열지 못했습니다");
    const { sessionId } = await send("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    await call("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 2, mobile: false }); // 글자 인식에 넉넉한 2배
    const url = pathToFileURL(file).href;
    const screen = async () => Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64");
    const open = async (page, first) => {
      const seconds = first ? 60 : 15;
      await call("Page.navigate", { url: "about:blank" });
      const target = `${url}#page=${page}&view=Fit&toolbar=0`;
      await call("Page.navigate", { url: target });
      for (let t = 0; t < seconds * 2; t++) {
        const { result } = await call("Runtime.evaluate", { expression: "location.href + ' ' + document.readyState", returnByValue: true });
        if (result.value === target + " complete") break;
        await wait(500);
      }
      await wait(first ? 5000 : 2000); // 보호 문서는 회사 계정 확인 뒤에 그려진다
      let shot = await screen();
      for (let t = 0, same = 0; t < seconds && same < 2; t++) {
        await wait(1000);
        const next = await screen();
        same = (await samePage(shot, next)) ? same + 1 : 0;
        shot = next;
      }
      return cropToPage(shot);
    };
    const pages = [];
    for (let i = only || 1; i <= (only || 150); i++) {
      const page = await open(i, !pages.length);
      if (!pages.length && (await blank(page))) throw new Error("Edge 화면이 비어 있습니다(문서 권한이 화면 표시를 막았을 수 있습니다).");
      if (pages.length && (await samePage(page, pages.at(-1)))) break; // 더 넘어가지 않는다(마지막 쪽)
      pages.push(page);
    }
    options.how = "Edge 화면 캡처(이 앱 전용 Edge 프로필)";
    return pages;
  } finally {
    await send("Browser.close").catch(() => {});
    edge.kill();
  }
}

// 겉 PDF 표시가 있거나 Forms 첨부(secured)이면 Edge로, 아니면 Windows PDF로 그리고 못 열면 Edge로
async function pdfPages(pdf, only, options) {
  if ((await wrapped(pdf)) || (options.secured && edgeExe())) return edgePages(pdf, only, options);
  return renderPdf(pdf, only).catch(() => edgePages(pdf, only, options));
}

// 문서(kind: pdf·word·powerpoint·excel)의 쪽 그림들. attachment-pages.mjs가 부른다.
export async function documentPages(kind, file, only, options) {
  if (kind === "pdf") return pdfPages(file, only, options);
  const dir = await mkdtemp(path.join(os.tmpdir(), "office-"));
  try {
    const pdf = path.join(dir, "문서.pdf");
    await officePdf(kind, file, pdf);
    return await pdfPages(pdf, only, options);
  } finally {
    await rm(dir, { recursive: true, force: true }); // 내보낸 PDF는 읽자마자 지운다
  }
}
