// Slack 보내기: 담당자 찾기(users.list), HTML 파일 보내기, 평가 의견 받아 작품에 담기.
//   보내기: 이 봇(idea_proposal)이 담당자에게 DM으로 HTML 파일을 보내고, 평가 단추 앱(slack-app/, Deno, idea-review)의
//          웹훅을 불러 담당자에게 [평가 답장하기] 단추 DM을 보내게 한다.
//   받기: 단추·입력 창은 Slack 서버에서 돌아가므로 아이디어정리가 꺼져 있어도 된다. 평가 단추 앱이 이 봇의 DM에 남긴 의견 메시지
//          (첫 블록 block_id "review|작품 id|보낸 사람")를 1분마다·켜질 때 찾아 담는다. 사람이 그냥 쓴 글은 받지 않는다.
// 설정(deploy/site.json의 slack, 부를 때마다 읽는다): botToken(xoxb-), reviewWebhook(평가 단추 앱 웹훅 주소)
// 봇 권한: users:read, chat:write, files:write, im:write, im:history. 토큰은 서버에만 있고 화면으로 보내지 않는다.
import { readSite } from "../deploy/site.mjs";
import { list, load, save } from "./store.mjs";
import { err } from "./validate.mjs";

const slack = () => readSite().slack || {};
const token = () => process.env.SLACK_BOT_TOKEN || slack().botToken || "";
export const slackReady = () => !!token();

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

// Slack Web API 한 번 부르기(폼 형식: 모든 메서드가 받는다). 실패하면 Slack이 준 오류 이름을 보여 준다.
async function call(method, params) {
  const key = token() || err("Slack 봇 토큰이 없습니다. deploy/site.json에 slack.botToken을 넣으세요.");
  const res = await send("https://slack.com/api/" + method, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const out = await res.json().catch(() => ({ ok: false, error: "HTTP " + res.status }));
  if (!out.ok) err(`Slack ${method} 실패 · ${out.error}`, 502);
  return out;
}

// 사람 목록은 10분 동안 기억한다(검색 글자를 칠 때마다 Slack에 묻지 않게). 나간 사람·봇은 뺀다.
let people = { at: 0, list: [] };
export async function slackPeople(query) {
  if (Date.now() - people.at > 600_000) {
    const list = [];
    let cursor = "";
    do {
      const out = await call("users.list", { limit: "200", cursor });
      for (const m of out.members)
        if (!m.deleted && !m.is_bot && m.id !== "USLACKBOT")
          list.push({ id: m.id, name: m.profile?.real_name || m.real_name || m.name, nick: m.profile?.display_name || "", title: m.profile?.title || "" });
      cursor = out.response_metadata?.next_cursor || "";
    } while (cursor);
    people = { at: Date.now(), list };
  }
  const q = String(query || "").trim().toLowerCase();
  return people.list.filter((p) => !q || [p.name, p.nick, p.title].some((v) => v.toLowerCase().includes(q))).slice(0, 20);
}

// user에게 DM 채널을 열고, 파일 올릴 주소를 받아 올린 뒤, 그 DM에 메시지(comment)와 함께 붙인다.
// 이어서 '의견 요청' 메시지를 하나 더 보내고, 답장을 찾을 자리({ channel, ts })를 돌려준다.
export async function sendHtml(user, { workId, title, filename, html, comment }) {
  const { reviewWebhook } = slack();
  if (!reviewWebhook) err("평가 단추 앱 설정이 없습니다. deploy/site.json의 slack에 reviewWebhook(웹훅 주소)을 넣으세요.");
  const channel = (await call("conversations.open", { users: user })).channel.id;
  const bytes = Buffer.from(html, "utf8");
  const slot = await call("files.getUploadURLExternal", { filename, length: String(bytes.length) });
  const up = await send(slot.upload_url, { method: "POST", body: bytes });
  if (!up.ok) err("Slack 파일 올리기 실패 · HTTP " + up.status, 502);
  await call("files.completeUploadExternal", {
    files: JSON.stringify([{ id: slot.file_id, title: filename }]),
    channel_id: channel,
    initial_comment: comment,
  });
  const hook = await send(reviewWebhook, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: user, work_id: workId, title, reply_channel: channel }) });
  if (!hook.ok) err("평가 단추를 보내지 못했습니다 · 평가 단추 앱 웹훅 HTTP " + hook.status, 502);
  return { channel };
}

// 의견 한 건을 작품에 더한다(같은 ts는 한 번만). 이름은 사람 목록에서 찾고, 없으면 보낸 기록의 이름.
function addReply(workId, send, { ts, user, text }) {
  const w = load(workId);
  if ((w.slackReplies || []).some((r) => r.ts === ts)) return;
  const name = people.list.find((p) => p.id === user)?.name || send.name;
  w.slackReplies = [...(w.slackReplies || []), { ts, user, name, text, at: new Date(Number(ts) * 1000).toISOString() }].sort((a, b) => Number(a.ts) - Number(b.ts));
  save(w);
}

// 평가 단추 앱이 남긴 의견 메시지 → [작품 id, 보낸 사람, 의견]. 아니면 null.
function reviewOf(m) {
  const [tag, workId, user] = String(m.blocks?.[0]?.block_id || "").split("|");
  const text = m.blocks?.[1]?.text?.text?.trim();
  return tag === "review" && workId && user && text ? { workId, user, text } : null;
}

// 보낸 지 30일 안의 보내기(작품 id 포함)를 그룹 DM마다 묶어, 마지막으로 읽은 뒤의 메시지에서 의견만 골라 담는다.
// 하나가 실패해도 나머지는 계속 본다.
const REPLY_DAYS = 30;
export async function collectReplies() {
  if (!slackReady()) return;
  const sends = list().flatMap((w) => (w.slackSent || [])
    .filter((s) => s.channel && Date.now() - Date.parse(s.at) < REPLY_DAYS * 86_400_000).map((s) => ({ work: w.id, ...s })));
  for (const channel of new Set(sends.map((s) => s.channel))) {
    const mine = sends.filter((s) => s.channel === channel);
    try {
      const oldest = Math.min(...mine.map((s) => Number(s.seen || Date.parse(s.at) / 1000))).toFixed(6);
      const { messages } = await call("conversations.history", { channel, oldest, limit: "200" });
      for (const m of messages) {
        const review = reviewOf(m), send = review && mine.find((s) => s.work === review.workId);
        if (send) addReply(send.work, send, { ts: m.ts, user: review.user, text: review.text });
      }
      const newest = messages.map((m) => Number(m.ts)).sort((a, b) => b - a)[0];
      if (newest) for (const s of mine) markSeen(s.work, s.at, newest.toFixed(6)); // 다음에는 여기부터 읽는다
    } catch (e) {
      console.error("Slack 의견 읽기 실패 ·", channel, e.message);
    }
  }
}
function markSeen(id, at, seen) {
  const w = load(id), s = w.slackSent.find((x) => x.at === at);
  if (!s || s.seen === seen) return;
  s.seen = seen;
  save(w);
}

export function startReplies() {
  collectReplies().catch(() => {});
  setInterval(() => collectReplies().catch(() => {}), 60_000).unref();
}
