// Slack 보내기: 담당자 찾기(users.list)와, 그 사람에게 DM으로 HTML 파일 보내기(파일 올리기 3단계).
// 봇 토큰은 환경 변수 SLACK_BOT_TOKEN 또는 deploy/site.json의 slack.botToken(부를 때마다 읽어 서버를 다시 켤 필요가 없다).
// 토큰은 서버에만 있고 화면으로 보내지 않는다. 필요한 권한: users:read, chat:write, im:write, files:write
import { readSite } from "../deploy/site.mjs";
import { err } from "./validate.mjs";

const token = () => process.env.SLACK_BOT_TOKEN || readSite().slack?.botToken || "";
export const slackReady = () => !!token();

// Slack Web API 한 번 부르기(폼 형식: 모든 메서드가 받는다). 실패하면 Slack이 준 오류 이름을 보여 준다.
async function call(method, params) {
  const key = token() || err("Slack 봇 토큰이 없습니다. deploy/site.json에 slack.botToken을 넣으세요.");
  const res = await fetch("https://slack.com/api/" + method, {
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
export async function sendHtml(user, { filename, html, comment }) {
  const channel = (await call("conversations.open", { users: user })).channel.id;
  const bytes = Buffer.from(html, "utf8");
  const slot = await call("files.getUploadURLExternal", { filename, length: String(bytes.length) });
  const up = await fetch(slot.upload_url, { method: "POST", body: bytes });
  if (!up.ok) err("Slack 파일 올리기 실패 · HTTP " + up.status, 502);
  await call("files.completeUploadExternal", {
    files: JSON.stringify([{ id: slot.file_id, title: filename }]),
    channel_id: channel,
    initial_comment: comment,
  });
}
