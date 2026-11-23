// MIP(민감도 레이블)로 암호화된 엑셀은 직접 풀 수 없어, 이 PC의 Excel 앱이 회사 계정으로 열어 값을 읽고 고친다.
//   맥: JXA(처음 한 번 macOS가 'Excel 제어 허용'을 묻는다). 이미 열려 있던 통합 문서는 닫지 않는다.
//   윈도우: PowerShell COM. 화면에 띄우지 않는 Excel을 따로 열고 끝나면 끈다(쓰던 Excel 창은 건드리지 않는다).
// 칸 위치는 '쓰인 범위'(UsedRange) 안에서 센다(읽을 때와 고칠 때 같게). 고칠 때 =·+·-·@로 시작하는 글은 수식이 되지 않게 '를 붙인다.
import { osascript, powershell } from "./scripting.mjs";

// ── 맥(JXA): work는 book·sheet(·input)로 일하고 결과를 out에 둔다. readOnly면 읽기 전용으로 연다
//    (자동 저장으로 파일이 바뀌면 바뀐 줄 알고 계속 다시 읽게 된다).
const jxa = (work, readOnly) => `function run([file, sheetName, input]) {
  const excel = Application("Microsoft Excel");
  const name = file.split("/").pop();
  const opened = excel.workbooks().find((w) => w.name() === name);
  if (!opened) {
    try { excel.openWorkbook({ workbookFileName: file, readOnly: ${readOnly} }); } catch (e) { excel.open(Path(file)); }
  }
  const book = opened || excel.workbooks().find((w) => w.name() === name) || excel.activeWorkbook();
  const sheet = sheetName ? book.worksheets.byName(sheetName) : book.worksheets[0];
  ${work}
  if (!opened) {
    book.close({ saving: "no" });
    if (!excel.workbooks().length) excel.quit(); // 이 일로 켠 Excel은 다시 끈다
  }
  return out;
}`;
const MAC_READ = jxa(`let rows = sheet.usedRange.value();
  if (!Array.isArray(rows)) rows = [[rows]];
  const two = (n) => String(n).padStart(2, "0");
  const cell = (v) => Object.prototype.toString.call(v) === "[object Date]"
    ? v.getFullYear() + "-" + two(v.getMonth() + 1) + "-" + two(v.getDate()) + " " + two(v.getHours()) + ":" + two(v.getMinutes())
    : v ?? "";
  const out = JSON.stringify(rows.map((r) => (Array.isArray(r) ? r : [r]).map(cell)));`, true);
const MAC_WRITE = jxa(`const used = sheet.usedRange;
  for (const c of JSON.parse(input)) used.rows[c.row].cells[c.column].value = c.value;
  try { book.save(); } catch (e) { excel.save(book); }
  const out = "";`, false);

// ── 윈도우(PowerShell COM): 날짜는 일련번호(Value2)로 넘긴다(읽는 쪽이 날짜로 바꾼다).
const windows = (work, readOnly) => `$excel = New-Object -ComObject Excel.Application
try {
  $excel.DisplayAlerts = $false
  $book = $excel.Workbooks.Open($env:CR_FILE, 0, $${readOnly})
  try {
    $sheet = if ($env:CR_SHEET) { $book.Worksheets.Item($env:CR_SHEET) } else { $book.Worksheets.Item(1) }
${work}
  } finally { $book.Close($false) }
} finally { if ($excel.Workbooks.Count -eq 0) { $excel.Quit() } }`;
const WINDOWS_READ = windows(`    Remove-TypeData System.Array -ErrorAction SilentlyContinue # 배열이 {value, Count}로 바뀌지 않게(PowerShell 5.1)
    $v = $sheet.UsedRange.Value2
    $rows = New-Object System.Collections.ArrayList
    if ($v -is [array]) {
      for ($i = $v.GetLowerBound(0); $i -le $v.GetUpperBound(0); $i++) {
        $row = New-Object object[] ($v.GetUpperBound(1) - $v.GetLowerBound(1) + 1)
        for ($j = $v.GetLowerBound(1); $j -le $v.GetUpperBound(1); $j++) { $row[$j - $v.GetLowerBound(1)] = $v[$i, $j] }
        [void]$rows.Add($row)
      }
    } else { [void]$rows.Add(@($v)) }
    ConvertTo-Json -InputObject $rows -Depth 3 -Compress`, true);
const WINDOWS_WRITE = windows(`    if ($book.ReadOnly) { throw '다른 곳에서 열려 있어 고칠 수 없습니다.' }
    $used = $sheet.UsedRange
    foreach ($c in ($env:CR_INPUT | ConvertFrom-Json)) {
      $cell = $used.Cells.Item($c.row + 1, $c.column + 1)
      if ([string]$c.value -eq '') { [void]$cell.ClearContents() } else { $cell.Value2 = [string]$c.value }
    }
    $book.Save()`, false);
export const EXCEL_SCRIPTS = { WINDOWS_READ, WINDOWS_WRITE }; // 윈도우 점검(tests)에서 문법을 확인한다

function excel(what, file, sheetName, input = "") {
  const fail = (e) => {
    throw new Error(`Excel 앱으로 응답 엑셀을 ${what} 못했습니다(Excel 설치·회사 계정 로그인 확인): ${e.message.replace(/^[^:]*: /, "")}`);
  };
  const reading = what === "읽지";
  if (process.platform === "darwin")
    return osascript(["-l", "JavaScript", "-e", reading ? MAC_READ : MAC_WRITE, file, sheetName, input], "Excel", { timeout: 180_000 }).catch(fail);
  if (process.platform === "win32")
    return powershell(reading ? WINDOWS_READ : WINDOWS_WRITE, { CR_FILE: file, CR_SHEET: sheetName, CR_INPUT: input }, "Excel", { timeout: 180_000 }).catch(fail);
  throw new Error("암호화(MIP)된 엑셀은 맥·윈도우의 Excel 앱으로만 다룰 수 있습니다.");
}

// 시트의 행들(빈 칸은 "")
export const excelRows = async (file, sheetName) =>
  JSON.parse((await excel("읽지", file, sheetName)) || "[]").map((row) => row.map((v) => v ?? ""));

// 칸들을 고치고 저장한다. cells: [{ row, column, value }] (쓰인 범위 안에서 0부터)
export const excelWrite = (file, sheetName, cells) =>
  excel("고치지", file, sheetName, JSON.stringify(cells.map((c) => ({ ...c, value: /^[=+\-@]/.test(c.value) ? "'" + c.value : c.value }))));
