// Slack 보내기: 담당자 찾기(users.list), 그 사람에게 DM으로 HTML 파일 보내기(파일 올리기 3단계),
// 그리고 담당자가 봇 DM에 쓴 답장(의견)을 1분마다 가져와 작품에 담기(collectReplies).
// 답장은 Slack에 남아 있으므로 서버가 꺼져 있던 동안 쓴 답장도 다시 켜지면 가져온다(마지막으로 읽은 메시지 시각부터).
// 봇 토큰은 환경 변수 SLACK_BOT_TOKEN 또는 deploy/site.json의 slack.botToken(부를 때마다 읽어 서버를 다시 켤 필요가 없다).
// 토큰은 서버에만 있고 화면으로 보내지 않는다. 필요한 권한: users:read, chat:write, im:write, files:write, im:history(답장 읽기)
import { readSite } from "../deploy/site.mjs";
import { list, load, save } from "./store.mjs";
import { err } from "./validate.mjs";

const token = () => process.env.SLACK_BOT_TOKEN || readSite().slack?.botToken || "";
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
export async function sendHtml(user, { filename, html, comment }) {
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
  const ask = await call("chat.postMessage", { channel, text: "💬 이 작품에 대한 의견을 이 DM에 *답장으로* 자유롭게 남겨 주세요. 남긴 의견은 아이디어정리 채점표에 담깁니다. (앞서 받은 다른 작품에 답하려면 그 작품의 이 메시지에 답글로 남겨 주세요.)" });
  return { channel, ts: ask.ts };
}

// 담당자가 봇 DM에 쓴 답장을 가져와 작품의 slackReplies에 더한다(같은 메시지는 ts로 한 번만).
// 어느 작품의 답장인지: 그 사람에게 보낸 작품 가운데 답장보다 먼저 보낸 가장 최근 작품.
// 앞서 보낸 작품에 답하려면 그 작품의 의견 요청 메시지에 답글(스레드)로 쓰면 그 작품으로 간다.
// 30일이 지난 보내기는 더 보지 않는다. DM 하나가 실패해도 다른 DM은 계속 본다.
const REPLY_DAYS = 30;
export async function collectReplies() {
  if (!slackReady()) return;
  const sends = list().flatMap((w) => (w.slackSent || []).filter((s) => s.ts && Date.now() - Date.parse(s.at) < REPLY_DAYS * 86_400_000).map((s) => ({ work: w.id, ...s })));
  for (const channel of new Set(sends.map((s) => s.channel))) {
    const mine = sends.filter((s) => s.channel === channel).sort((a, b) => a.ts.localeCompare(b.ts));
    try {
      const oldest = mine.map((s) => s.seen || s.ts).sort()[0];
      const top = (await call("conversations.history", { channel, oldest, limit: "200" })).messages;
      const threads = top.filter((m) => m.reply_count && mine.some((s) => s.ts === m.ts));
      const replies = (await Promise.all(threads.map((m) => call("conversations.replies", { channel, ts: m.ts, oldest, limit: "200" }))))
        .flatMap((out) => out.messages.slice(1));
      const forWork = new Map();
      for (const m of [...top, ...replies].filter((m) => !m.bot_id && m.user && m.text)) {
        const send = m.thread_ts && m.thread_ts !== m.ts ? mine.find((s) => s.ts === m.thread_ts) : mine.findLast((s) => s.ts < m.ts);
        if (send) forWork.set(send.work, [...(forWork.get(send.work) || []), { m, send }]);
      }
      const newest = [...top, ...replies].map((m) => m.ts).sort().at(-1);
      for (const [id, got] of forWork) {
        const w = load(id);
        const known = new Set((w.slackReplies || []).map((r) => r.ts));
        w.slackReplies = [...(w.slackReplies || []), ...got.filter(({ m }) => !known.has(m.ts)).map(({ m, send }) => ({
          ts: m.ts, user: m.user, name: people.list.find((p) => p.id === m.user)?.name || send.name, text: m.text, at: new Date(Number(m.ts) * 1000).toISOString(),
        }))].sort((a, b) => a.ts.localeCompare(b.ts));
        save(w);
      }
      if (newest) for (const s of mine) markSeen(s.work, s.ts, newest); // 다음에는 여기부터 읽는다
    } catch (e) {
      console.error("Slack 답장 읽기 실패 ·", channel, e.message);
    }
  }
}
function markSeen(id, ts, seen) {
  const w = load(id), s = w.slackSent.find((x) => x.ts === ts);
  if (s.seen === seen) return;
  s.seen = seen;
  save(w);
}

export function startReplies() {
  collectReplies().catch(() => {});
  setInterval(() => collectReplies().catch(() => {}), 60_000).unref();
}
