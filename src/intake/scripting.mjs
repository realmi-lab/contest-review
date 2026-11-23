// 이 PC의 앱을 다루는 스크립트 실행: 맥은 osascript(AppleScript·JXA), 윈도우는 PowerShell(COM·WinRT).
// 오류에는 스크립트가 알린 글만 넣는다(e.message에는 스크립트 전체가 들어 있다).
import { execFile } from "node:child_process";

// PowerShell이 오류를 CLIXML로 보내면 그 안의 글만 꺼낸다
const plain = (text) =>
  text.startsWith("#< CLIXML")
    ? [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1].replace(/_x000D__x000A_/g, " ")).join("").trim()
    : text.trim();

const run = (command, args, what, { timeout = 300_000, env } = {}) =>
  new Promise((resolve, reject) =>
    execFile(command, args, { timeout, maxBuffer: 64 << 20, windowsHide: true, env: env && { ...process.env, ...env } }, (e, out, errText) =>
      e ? reject(new Error(`${what}: ${plain(String(errText)) || (e.killed ? "시간 초과" : "종료 코드 " + e.code)}`)) : resolve(String(out).trim())));

export const osascript = (args, what, options) => run("osascript", args, what, options);

// Windows PowerShell 5.1(powershell.exe: COM·WinRT를 바로 쓴다). 스크립트는 -EncodedCommand로 넘겨 따옴표·한글이 깨지지 않게 하고,
// 값은 환경 변수(env)로 넘긴다. 출력은 UTF-8, 오류는 메시지 한 줄로 받는다.
export function powershell(script, env, what, options) {
  const body = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
try {
${script}
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  const args = ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", Buffer.from(body, "utf16le").toString("base64")];
  return run("powershell.exe", args, what, { ...options, env });
}
