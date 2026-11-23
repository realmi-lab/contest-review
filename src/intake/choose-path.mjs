// 서버 화면에 파일·폴더 선택 창을 띄운다(맥: AppleScript, 윈도우: PowerShell). 취소하면 "".
// 창이 떠 있는 동안 요청이 기다린다(최대 10분).
import path from "node:path";
import { osascript, powershell } from "./scripting.mjs";

const what = "선택 창을 열지 못했습니다";

// file: true면 응답 엑셀(.xlsx) 파일, false면 첨부 폴더. start: 처음 열 폴더
export async function choosePath(file, start) {
  let picked;
  if (process.platform === "win32") {
    const dialog = file
      ? "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Excel (*.xlsx)|*.xlsx'; $d.InitialDirectory = $env:START_DIR; $pick = { $d.FileName }"
      : "$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.SelectedPath = $env:START_DIR; $pick = { $d.SelectedPath }";
    picked = await powershell(`Add-Type -AssemblyName System.Windows.Forms; ${dialog}; if ($d.ShowDialog() -eq 'OK') { & $pick }`, { START_DIR: start || "" }, what, { timeout: 600_000 });
  } else {
    const quote = (t) => '"' + String(t).replace(/[\\"]/g, "\\$&") + '"';
    const where = start ? ` default location (POSIX file ${quote(start)})` : "";
    const ask = file
      ? `choose file with prompt "MS Forms 응답 엑셀을 고르세요" of type {"org.openxmlformats.spreadsheetml.sheet"}${where}`
      : `choose folder with prompt "첨부 파일이 내려받아지는 폴더를 고르세요"${where}`;
    picked = await osascript(["-e", "activate", "-e", `POSIX path of (${ask})`], what, { timeout: 600_000 }).catch((e) => {
      if (/-128/.test(e.message)) return ""; // 취소
      throw e;
    });
  }
  return picked && path.resolve(picked);
}
