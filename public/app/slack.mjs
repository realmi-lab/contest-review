// Slack 보내기(채점표 탭): 담당자를 이름으로 검색해 고르고, 내보내기 HTML을 그 사람에게 DM으로 보낸다(서버 src/slack.mjs).
import { esc, join, seoulMinute } from "../lib/html.mjs";
import { sync } from "./navigation.mjs";
import { state } from "./state.mjs";
import { $, api, notify } from "./ui.mjs";

let picked = null, timer = 0;

// 보낸 기록: 누구에게 언제 보냈고, 그 사람이 답장했는지(답장 수). 최근 것이 위.
function sentList() {
  const sent = state.work.slackSent || [], replies = state.work.slackReplies || [];
  if (!sent.length) return "";
  const rows = [...sent].reverse().map((s) => {
    const n = replies.filter((r) => r.user === s.user).length;
    return `<tr><td>${esc(s.name)}</td><td>${seoulMinute(s.at)}</td><td>${n ? `<b class="ok-text">답장 ${n}건</b>` : '<span class="muted">답장 기다리는 중</span>'}</td></tr>`;
  });
  return `<div class="slack-history"><h4>보낸 기록 · ${sent.length}건</h4>
    <table><thead><tr><th>받는 사람</th><th>보낸 시각</th><th>답장</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

// 담당자가 봇 DM에 남긴 답장(서버가 1분마다 가져온다). 채점표 탭에 그대로 보여 준다.
// 여러 사람이 보낸 의견은 사람마다 카드 하나로 묶어 각각 보여 준다(카드 안은 보낸 순서).
function repliesList() {
  const replies = state.work.slackReplies || [];
  if (!replies.length) return "";
  const byPerson = Map.groupBy(replies, (r) => r.user);
  return `<div class="slack-replies"><h4>담당자 의견 · ${byPerson.size}명</h4>
    <div class="reply-cards">${join([...byPerson.values()], (mine) => `<section class="reply-card">
      <h5>${esc(mine.at(-1).name)}<small>${mine.length > 1 ? `의견 ${mine.length}건 · ` : ""}${seoulMinute(mine.at(-1).at)}</small></h5>
      ${join(mine, (r) => `<p>${esc(r.text)}${mine.length > 1 ? `<small>${seoulMinute(r.at)}</small>` : ""}</p>`)}
    </section>`)}</div></div>`;
}

// 채점표 탭 맨 위: Slack에 있는 사람을 이름으로 검색 → 고르기 → 보내기. 보낸 기록과 담당자 의견(DM 답장)도 여기 보여 준다.
export function slackPanel() {
  if (!state.work.captures.length) return "";
  if (!state.app.slack)
    return `<section class="panel slack-send no-print"><h3>담당자에게 보내기</h3><p class="small muted">deploy/site.json에 Slack 봇 토큰(slack.botToken)을 넣으면 Slack에 있는 사람을 검색해 보낼 수 있습니다.</p>${repliesList()}</section>`;
  picked = null;
  return `<section class="panel slack-send no-print"><h3>담당자에게 보내기</h3>
    <p class="small muted">캡처 자료·AI 요약·AI 논리점검을 HTML 한 파일로 만들어 Slack DM으로 보냅니다. 받은 사람이 [평가 답장하기]로 보낸 의견이 아래 담당자 의견에 담깁니다(아이디어정리가 꺼져 있어도 보낼 수 있고, 켜지면 가져옵니다).</p>
    <input id="slack-q" type="search" placeholder="Slack에서 이름으로 검색" autocomplete="off" aria-label="담당자 이름">
    <ul id="slack-people" class="slack-people" aria-live="polite"></ul>
    <div class="slack-go"><span id="slack-picked" class="muted">검색해서 담당자를 고르세요</span>
      <button id="slack-go" type="button" class="primary" data-action="slack-go" disabled>보내기</button></div>
    ${sentList()}
    ${repliesList()}
  </section>`;
}

// 글자를 칠 때마다가 아니라 멈춘 뒤 0.25초에 한 번 찾는다.
export function findPeople(query) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const list = $("slack-people");
    if (!list) return;
    if (!query.trim()) return void (list.innerHTML = ""); // 검색어가 있을 때만 보여 준다
    try {
      const people = await api("slack-people?q=" + encodeURIComponent(query));
      list.innerHTML = join(people, (p) =>
        `<li><button type="button" data-slack-user="${esc(p.id)}" data-slack-name="${esc(p.name)}" aria-pressed="${picked?.user === p.id}">
          <b>${esc(p.name)}</b>${p.title || p.nick ? `<small>${esc([p.nick, p.title].filter(Boolean).join(" · "))}</small>` : ""}</button></li>`) ||
        '<li class="small muted">찾는 사람이 없습니다</li>';
    } catch (e) {
      list.innerHTML = `<li class="small warn-text">${esc(e.message)}</li>`;
    }
  }, 250);
}

export function pickPerson(b) {
  picked = { user: b.dataset.slackUser, name: b.dataset.slackName };
  for (const x of document.querySelectorAll("[data-slack-user]")) x.setAttribute("aria-pressed", x === b);
  $("slack-picked").textContent = "받는 사람 · " + picked.name;
  $("slack-go").disabled = false;
}

export async function sendToPerson() {
  const go = $("slack-go");
  go.disabled = true;
  go.textContent = "보내는 중…";
  try {
    await api("slack-send", { id: state.work.id, rev: state.work.rev, ...picked });
    notify(`${picked.name}님에게 Slack으로 보냈습니다.`);
    await sync(true);
  } finally {
    if (go.isConnected) {
      go.disabled = false;
      go.textContent = "보내기";
    }
  }
}
