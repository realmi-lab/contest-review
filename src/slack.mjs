// Slack 보내기: 담당자 찾기(users.list), 그 사람에게 DM으로 HTML 파일 보내기(파일 올리기 3단계),
// 그리고 담당자의 평가 의견을 받아 작품에 담기. 의견은 두 길로 받는다(아무 DM 글은 받지 않는다).
//   1) DM의 [평가 답장하기] 단추 → 입력 창 → 바로 그 작품에 담긴다(Socket Mode: 서버가 Slack에 연결해 두고 받는다. 서버가 켜져 있어야 한다).
//   2) 의견 요청 메시지에 단 스레드 답글 → 1분마다 가져온다(서버가 꺼져 있던 동안의 답글도 다시 켜지면 가져온다).
// 토큰: 봇 토큰 slack.botToken(SLACK_BOT_TOKEN), 단추를 받는 앱 토큰 slack.appToken(SLACK_APP_TOKEN, xapp-, connections:write).
// deploy/site.json에서 부를 때마다 읽는다. 토큰은 서버에만 있고 화면으로 보내지 않는다.
// 봇 권한: users:read, chat:write, im:write, files:write, im:history(스레드 답글 읽기)
import { readSite } from "../deploy/site.mjs";
import { list, load, save } from "./store.mjs";
import { err } from "./validate.mjs";

const token = () => process.env.SLACK_BOT_TOKEN || readSite().slack?.botToken || "";
const appToken = () => process.env.SLACK_APP_TOKEN || readSite().slack?.appToken || "";
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
async function call(method, params, key = token()) {
  if (!key) err("Slack 봇 토큰이 없습니다. deploy/site.json에 slack.botToken을 넣으세요.");
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
  const ask = await call("chat.postMessage", { channel, text: "💬 이 작품에 대한 평가 의견을 보내 주세요", blocks: JSON.stringify(askBlocks()) });
  return { channel, ts: ask.ts };
}

// 의견 요청 메시지: 안내 + [평가 답장하기] 단추. 단추 값은 비워 두고, 누르면 메시지의 ts로 어느 작품인지 찾는다.
const askBlocks = () => [
  { type: "section", text: { type: "mrkdwn", text: "💬 *이 작품에 대한 평가 의견을 보내 주세요*\n아래 *평가 답장하기*를 누르면 입력 창이 열립니다. 보낸 의견은 아이디어정리 채점표에 담깁니다.\n_창이 열리지 않으면 이 메시지에 스레드 답글로 남겨 주세요._" } },
  { type: "actions", elements: [{ type: "button", action_id: "review_reply", style: "primary", text: { type: "plain_text", text: "평가 답장하기" } }] },
];

// 의견 한 건을 작품에 더한다(같은 ts는 한 번만). 이름은 사람 목록에서 찾고, 없으면 보낸 기록의 이름.
function addReply(workId, send, { ts, user, text }) {
  const w = load(workId);
  if ((w.slackReplies || []).some((r) => r.ts === ts)) return false;
  const name = people.list.find((p) => p.id === user)?.name || send.name;
  w.slackReplies = [...(w.slackReplies || []), { ts, user, name, text, at: new Date(Number(ts) * 1000).toISOString() }].sort((a, b) => Number(a.ts) - Number(b.ts));
  save(w);
  return true;
}

// 보낸 지 30일 안의 보내기(작품 id 포함). 단추를 누른 메시지·스레드 답글이 어느 작품인지 ts로 찾는다.
const REPLY_DAYS = 30;
const activeSends = () => list().flatMap((w) => (w.slackSent || [])
  .filter((s) => s.ts && Date.now() - Date.parse(s.at) < REPLY_DAYS * 86_400_000).map((s) => ({ work: w.id, ...s })));

// 의견 요청 메시지마다 새 스레드 답글을 가져온다(마지막으로 읽은 답글 다음부터). 하나가 실패해도 나머지는 계속 본다.
export async function collectReplies() {
  if (!slackReady()) return;
  for (const s of activeSends()) {
    try {
      const out = await call("conversations.replies", { channel: s.channel, ts: s.ts, oldest: s.seen || s.ts, limit: "200" });
      const fresh = out.messages.filter((m) => Number(m.ts) > Number(s.seen || s.ts) && !m.bot_id && m.user && m.text);
      for (const m of fresh) addReply(s.work, s, m);
      if (fresh.length) markSeen(s.work, s.ts, fresh.at(-1).ts);
    } catch (e) {
      console.error("Slack 답글 읽기 실패 ·", s.work, e.message);
    }
  }
}
function markSeen(id, ts, seen) {
  const w = load(id), s = w.slackSent.find((x) => x.ts === ts);
  s.seen = seen;
  save(w);
}

// Socket Mode로 받은 봉투 하나 처리: 단추를 누르면 입력 창을 열고, 창을 보내면 의견을 그 작품에 담고 DM으로 알린다.
// 봉투는 3초 안에 받았다고 답해야 한다(ack). 입력 창이 비었으면 창에 오류를 띄운다.
export async function handleEnvelope({ envelope_id, payload }, ack) {
  if (payload?.type === "block_actions" && payload.actions?.[0]?.action_id === "review_reply") {
    ack();
    const send = activeSends().find((s) => s.ts === payload.message?.ts);
    await call("views.open", { trigger_id: payload.trigger_id, view: JSON.stringify(send ? replyView(send) : expiredView()) });
  } else if (payload?.type === "view_submission" && payload.view?.callback_id === "review_reply") {
    const { ts } = JSON.parse(payload.view.private_metadata);
    const text = payload.view.state.values.opinion?.text?.value?.trim();
    if (!text) return ack({ response_action: "errors", errors: { opinion: "의견을 적어 주세요" } });
    ack();
    const send = activeSends().find((s) => s.ts === ts);
    if (!send) return;
    addReply(send.work, send, { ts: (Date.now() / 1000).toFixed(6), user: payload.user.id, text });
    await call("chat.postMessage", { channel: send.channel, thread_ts: send.ts, text: "✅ 의견이 채점표에 담겼습니다. 감사합니다." });
  } else ack();
}
const replyView = (send) => ({
  type: "modal", callback_id: "review_reply", private_metadata: JSON.stringify({ ts: send.ts }),
  title: { type: "plain_text", text: "평가 답장하기" }, submit: { type: "plain_text", text: "보내기" }, close: { type: "plain_text", text: "닫기" },
  blocks: [{ type: "input", block_id: "opinion", label: { type: "plain_text", text: "평가 의견" },
    element: { type: "plain_text_input", action_id: "text", multiline: true, placeholder: { type: "plain_text", text: "이 작품에 대한 의견을 자유롭게 적어 주세요" } } }],
});
const expiredView = () => ({ type: "modal", title: { type: "plain_text", text: "평가 답장하기" }, close: { type: "plain_text", text: "닫기" },
  blocks: [{ type: "section", text: { type: "mrkdwn", text: "이 요청은 30일이 지났거나 작품이 지워져 더 받지 않습니다." } }] });

// Socket Mode 연결: 앱 토큰으로 연결 주소를 받아 WebSocket을 열어 둔다. 끊기면 10초 뒤 다시 연결한다.
// 서버가 Slack 쪽으로 나가는 연결이라 이 서버의 웹 주소가 필요 없다.
function connectSocket() {
  const retry = () => setTimeout(connectSocket, 10_000).unref();
  if (!appToken() || !slackReady()) return retry();
  call("apps.connections.open", {}, appToken()).then(({ url }) => {
    const ws = new WebSocket(url);
    ws.onmessage = (event) => {
      const envelope = JSON.parse(event.data);
      if (envelope.type === "disconnect") return ws.close();
      if (!envelope.envelope_id) return;
      const ack = (payload) => ws.send(JSON.stringify({ envelope_id: envelope.envelope_id, ...(payload ? { payload } : {}) }));
      handleEnvelope(envelope, ack).catch((e) => console.error("Slack 단추 처리 실패 ·", e.message));
    };
    ws.onclose = retry;
  }).catch((e) => {
    console.error("Slack Socket Mode 연결 실패 ·", e.message);
    retry();
  });
}

export function startReplies() {
  collectReplies().catch(() => {});
  setInterval(() => collectReplies().catch(() => {}), 60_000).unref();
  connectSocket();
}
