// Slack 보내기: 담당자 찾기, HTML 파일 보내기, 평가 의견 받아 작품에 담기. 모두 평가 단추 앱(slack-app/, Deno, idea-review) 하나로 한다.
//   보내기: 앱의 웹훅에 HTML을 실어 부르면, 앱이 담당자 DM에 HTML 파일과 [평가 답장하기] 단추를 보낸다.
//   찾기·받기: 앱이 저장소에 둔 사람 목록(people, 매일 맞춤)과 받은 의견(reviews)을 이 컴퓨터의 Slack CLI로 읽는다
//          (slack datastore query --app 앱 ID). 봇 토큰은 필요 없고, CLI가 설치·로그인돼 있어야 한다. 의견은 켜질 때·1분마다 읽는다.
//   단추·입력 창은 Slack 서버에서 돌아가므로 아이디어정리가 꺼져 있어도 담당자는 의견을 보낼 수 있다.
// 설정(deploy/site.json의 slack, 부를 때마다 읽는다): reviewWebhook(앱 웹훅 주소)
//   선택: reviewApp(앱 ID A…, 없으면 이 폴더에서 배포한 앱 'deployed'), cli(slack 명령 경로)
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readSite } from "../deploy/site.mjs";
import { list, load, save } from "./store.mjs";
import { err } from "./validate.mjs";

const slack = () => readSite().slack || {};
export const slackReady = () => !!slack().reviewWebhook;

// slack.com에 닿지 못하면 'fetch failed'만 나와 원인을 알 수 없다. 원인 코드(인증서·이름 찾기·시간 초과 등)를 붙여 보여 준다.
// 회사망에서 흔한 원인: 프록시(서버 Node는 브라우저의 프록시 설정을 쓰지 않는다), 보안 장비가 바꿔 끼운 인증서.
async function send(url, options) {
  try {
    return await fetch(url, options);
  } catch (e) {
    const cause = e.cause?.code || e.cause?.message || e.message;
    const hint = /CERT|SSL|TLS/i.test(cause) ? " · 회사 보안 장비의 인증서 때문일 수 있습니다(서버를 start.sh·start.bat으로 다시 켜면 이 컴퓨터의 인증서를 믿습니다)"
      : /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/.test(cause) ? " · 이 서버에서 slack.com으로 나가는 길이 막혔을 수 있습니다(방화벽·프록시)" : "";
    err(`Slack에 연결하지 못했습니다 · ${cause}${hint}`, 502);
  }
}

// Slack CLI로 앱 저장소의 항목을 모두 읽는다(--to-file이 쪽을 넘겨 JSON Lines로 저장한다).
// CLI는 slack-app 폴더에서 돌려 배포 기록(.slack/)을 찾게 하고, 설치 위치(~/.slack/bin)와 Deno 인증서 설정을 붙여 준다.
const exec = promisify(execFile);
const appDir = fileURLToPath(new URL("../slack-app/", import.meta.url));
async function readStore(datastore, query = {}) {
  const { reviewApp = "deployed", cli = "slack" } = slack();
  const dir = await mkdtemp(path.join(os.tmpdir(), "slack-store-"));
  const file = path.join(dir, "items.jsonl");
  const env = { ...process.env, DENO_TLS_CA_STORE: "system",
    PATH: [path.join(os.homedir(), ".slack", "bin"), path.join(os.homedir(), ".deno", "bin"), process.env.PATH].join(path.delimiter) };
  try {
    await exec(cli, ["datastore", "query", JSON.stringify(query), "--datastore", datastore, "--app", reviewApp, "--to-file", file], { cwd: appDir, env, timeout: 60_000 });
    const text = await readFile(file, "utf8").catch(() => ""); // 항목이 없으면 파일이 없을 수 있다
    return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  } catch (e) {
    if (e.status) throw e; // 위의 err
    const why = e.code === "ENOENT" ? "Slack CLI(slack 명령)를 찾지 못했습니다. 이 컴퓨터에 설치하고 slack login을 하세요(slack-app/README.md)"
      : String(e.stderr || e.stdout || e.message).trim().split("\n").slice(-3).join(" ");
    err(`Slack 저장소(${datastore})를 읽지 못했습니다 · ${why}`, 502);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 사람 목록은 10분 동안 기억한다(검색 글자를 칠 때마다 CLI를 부르지 않게). 저장소에는 쪽마다 JSON 목록이 들어 있다.
let people = { at: 0, list: [] };
export async function slackPeople(query) {
  if (Date.now() - people.at > 600_000) {
    const pages = (await readStore("people")).sort((a, b) => Number(a.id) - Number(b.id));
    if (!pages.length) err("Slack 사람 목록이 아직 없습니다. 평가 단추 앱의 '사람 목록 맞추기'를 만들었는지 확인하세요(slack-app/README.md).");
    people = { at: Date.now(), list: pages.flatMap((p) => JSON.parse(p.list)) };
  }
  const q = String(query || "").trim().toLowerCase();
  return people.list.filter((p) => !q || [p.name, p.nick, p.title].some((v) => v.toLowerCase().includes(q))).slice(0, 20);
}

// 평가 단추 앱의 웹훅에 HTML과 안내 글(comment)을 실어 보낸다. 파일 올리기·단추 DM은 그 앱이 한다.
export async function sendHtml(user, { workId, title, filename, html, comment }) {
  const { reviewWebhook } = slack();
  if (!reviewWebhook) err("평가 단추 앱 설정이 없습니다. deploy/site.json의 slack에 reviewWebhook(웹훅 주소)을 넣으세요.");
  const hook = await send(reviewWebhook, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: user, work_id: workId, title, filename, comment, html }) });
  // 400은 대개 웹훅의 입력과 배포한 앱의 웹훅 정의가 다를 때, 413은 HTML이 너무 클 때다. Slack이 준 까닭을 붙여 보여 준다.
  if (!hook.ok) err(`평가 단추 앱에 보내지 못했습니다 · 웹훅 HTTP ${hook.status} ${(await hook.text().catch(() => "")).slice(0, 200)}`.trim(), 502);
}

// 의견 한 건을 작품에 더한다(같은 id는 한 번만). 이름은 사람 목록에서 찾고, 없으면 그 사람에게 보낸 기록의 이름.
function addReply(w, { id, user_id: user, text, at }) {
  if ((w.slackReplies || []).some((r) => r.id === id)) return;
  const name = people.list.find((p) => p.id === user)?.name || w.slackSent?.findLast((s) => s.user === user)?.name || user;
  w.slackReplies = [...(w.slackReplies || []), { id, user, name, text, at }].sort((a, b) => a.at.localeCompare(b.at));
  save(w);
}

// 최근 30일에 보낸 작품이 있을 때만, 그동안 받은 의견을 읽어 그 작품에 담는다.
const REPLY_DAYS = 30;
export async function collectReplies() {
  if (!slackReady()) return;
  const since = new Date(Date.now() - REPLY_DAYS * 86_400_000).toISOString();
  const sentIds = new Set(list().filter((w) => (w.slackSent || []).some((s) => s.at > since)).map((w) => w.id));
  if (!sentIds.size) return;
  const items = await readStore("reviews", { expression: "#at > :since", expression_attributes: { "#at": "at" }, expression_values: { ":since": since } });
  for (const r of items) if (sentIds.has(r.work_id)) addReply(load(r.work_id), r);
}

export function startReplies() {
  const collect = () => collectReplies().catch((e) => console.error("Slack 의견 읽기 실패 ·", e.message));
  collect();
  setInterval(collect, 60_000).unref();
}
