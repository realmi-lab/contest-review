// 아이디어정리 서버: 화면 파일과 API를 내려 주고, 공모 연동·글자 인식·AI 요약 작업을 돌린다.
//   localhost 실행: http://localhost:18765 (./start.sh, start.bat)
//   웹 모드: deploy/site.json의 network 주소에서 https (deploy/start-web.py)
import { spawn } from "node:child_process";
import http from "node:http";
import { listenAddress, webServer } from "../deploy/web-server.mjs";
import { requeueOcr } from "./captures.mjs";
import { directory, port, webMode } from "./config.mjs";
import { createHandler } from "./http.mjs";
import { startIntake } from "./intake/sync.mjs";
import { startReplies } from "./slack.mjs";
import { onJobEnd, tasks } from "./jobs.mjs";
import settingsRoutes from "./routes/settings.mjs";
import worksRoutes from "./routes/works.mjs";
import { close, load, save } from "./store.mjs";
import { autoSummarize } from "./summary/run.mjs";

process.umask(0o077);
onJobEnd((wid) => autoSummarize(wid).catch(() => {})); // 지워진 작품·키 없음 등은 넘어간다
requeueOcr();
startIntake();
startReplies(); // Slack 답장(의견)을 1분마다 가져온다

// 서비스 재시작 때 진행 중이던 요약·점검이 말없이 사라지지 않도록 작품에 적는다.
// 대기 중인 글자 인식은 다음 시작 때 다시 줄을 선다.
function stopServer() {
  for (const [key, job] of tasks) {
    if (key.startsWith("ocr-")) continue;
    try {
      const w = load(job.work);
      w.error = "서버가 다시 시작되어 작업이 중단되었습니다. 다시 실행하세요.";
      save(w);
    } catch {}
  }
  close();
  process.exit(0);
}
process.once("SIGTERM", stopServer);
process.once("SIGINT", stopServer);

const handle = createHandler({ ...settingsRoutes, ...worksRoutes });
const server = webMode ? await webServer(directory, handle) : http.createServer(handle);
const address = webMode ? listenAddress : "127.0.0.1";
server.on("error", (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  console.error(`${address}:${port}를 이미 다른 프로그램이 쓰고 있습니다. 먼저 띄운 서버를 끈 뒤 다시 실행하세요.`);
  process.exit(1);
});
server.listen(port, address, () => {
  const boundPort = server.address().port;
  console.log("아이디어정리 %s://%s:%d", webMode ? "https" : "http", address, boundPort);
  if (process.platform === "win32" && !webMode && process.argv.includes("--open-browser")) {
    const url = `http://localhost:${boundPort}`;
    const browser = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true });
    browser.on("error", () => console.error(`브라우저에서 ${url} 을 여세요.`));
    browser.unref();
  }
});
