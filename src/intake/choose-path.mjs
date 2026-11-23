// 서버 화면에 파일·폴더 선택 창을 띄운다(맥: AppleScript, 윈도우: PowerShell). 취소하면 "".
// 창이 떠 있는 동안 요청이 기다린다(최대 10분).
import { execFile } from "node:child_process";
import path from "node:path";

function run(command, args, env = {}) {
  return new Promise((resolve, reject) =>
    execFile(command, args, { timeout: 600_000, env: { ...process.env, ...env } }, (e, out, errText) =>
      e ? (/-128/.test(errText) ? resolve("") : reject(new Error("선택 창을 열지 못했습니다: " + String(errText).trim())))
        : resolve(out.trim() && path.resolve(out.trim()))));
}

// file: true면 응답 엑셀(.xlsx) 파일, false면 첨부 폴더. start: 처음 열 폴더
export function choosePath(file, start) {
  if (process.platform === "win32") {
    const dialog = file
      ? "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Excel (*.xlsx)|*.xlsx'; $d.InitialDirectory = $env:START_DIR; $pick = { $d.FileName }"
      : "$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.SelectedPath = $env:START_DIR; $pick = { $d.SelectedPath }";
    return run("powershell", ["-NoProfile", "-STA", "-Command", "Add-Type -AssemblyName System.Windows.Forms; " + dialog +
      "; [Console]::OutputEncoding = [Text.Encoding]::UTF8; if ($d.ShowDialog() -eq 'OK') { & $pick }"], { START_DIR: start || "" });
  }
  const quote = (t) => '"' + String(t).replace(/[\\"]/g, "\\$&") + '"';
  const where = start ? ` default location (POSIX file ${quote(start)})` : "";
  const ask = file
    ? `choose file with prompt "MS Forms 응답 엑셀을 고르세요" of type {"org.openxmlformats.spreadsheetml.sheet"}${where}`
    : `choose folder with prompt "첨부 파일이 내려받아지는 폴더를 고르세요"${where}`;
  return run("osascript", ["-e", "activate", "-e", `POSIX path of (${ask})`]);
}
