// Slack 보내기 대화상자: 담당자를 이름으로 검색해 고르고, 내보내기 HTML을 그 사람에게 DM으로 보낸다(서버 src/slack.mjs).
import { esc, join, seoulMinute } from "../lib/html.mjs";
import { sync } from "./navigation.mjs";
import { state } from "./state.mjs";
import { $, api, closeDialog, dialog, notify } from "./ui.mjs";

let picked = null, timer = 0;

export function openSlackSend() {
  picked = null;
  const sent = state.work.slackSent || [];
  dialog("담당자에게 보내기", `<div class="stack slack-send">
    <p class="small muted">핵심·세부 요약, AI 논리점검, 원본 캡처를 HTML 한 파일로 만들어 Slack DM으로 보냅니다.</p>
    <input id="slack-q" type="search" placeholder="이름으로 검색" autocomplete="off" aria-label="담당자 이름">
    <ul id="slack-people" class="slack-people" aria-live="polite"></ul>
    <div class="slack-go"><span id="slack-picked" class="muted">담당자를 고르세요</span>
      <button id="slack-go" type="button" class="primary" data-action="slack-go" disabled>보내기</button></div>
    ${sent.length ? `<p class="small muted">보낸 기록 · ${esc(sent.map((s) => `${s.name} ${seoulMinute(s.at)}`).join(" · "))}</p>` : ""}
  </div>`);
  $("slack-q").focus();
  findPeople("");
}

// 글자를 칠 때마다가 아니라 멈춘 뒤 0.25초에 한 번 찾는다.
export function findPeople(query) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const list = $("slack-people");
    if (!list) return;
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
    closeDialog();
    notify(`${picked.name}님에게 Slack으로 보냈습니다.`);
    await sync(true);
  } finally {
    if (go.isConnected) {
      go.disabled = false;
      go.textContent = "보내기";
    }
  }
}
