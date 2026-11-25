// 설정 대화상자: 왼쪽 아래 톱니바퀴(설정) → 기능 켜고 끄기(AI 논리점검)와 요약 설정·공모 연동 설정·운영 맥 점검
import { esc, join } from "../lib/html.mjs";
import { sync } from "./navigation.mjs";
import { aiLabel, cloudScope, logicOn, state, summaryModel } from "./state.mjs";
import { usd } from "./summary.mjs";
import { $, api, button, dialog, field, input } from "./ui.mjs";

// 최근 7일(UTC) 사용량 표: 앱이 응답마다 받은 사용량으로 적은 기록과 Anthropic이 직접 집계한 토큰을 나란히 놓는다.
// 두 토큰 수가 같으면 앱의 비용 추정을 믿을 수 있다. 같은 키를 다른 프로그램도 쓰면 Anthropic 쪽이 더 크게 나온다.
function usageCheck({ days, reported, reportError, recordingSince }) {
  const n = (v) => v.toLocaleString("ko-KR");
  const money = (v) => (v === null ? "확인 불가" : usd.format(Number(v.toFixed(4))));
  const rows = join(days, (d) => {
    const r = reported?.[d.day];
    const unmeasured = d.requests - d.measured;
    return `<tr><th scope="row">${d.day}</th><td>${d.runs}회${unmeasured ? ` <small>응답 없음 ${unmeasured}건</small>` : ""}</td>
      <td>${n(d.totalTokens)}</td><td>${money(d.estimatedUsd)}</td>
      ${reported ? `<td>${r ? n(r.totalTokens) : "—"}</td><td>${r ? money(r.usd) : "—"}</td>
        <td>${r ? (r.totalTokens === d.totalTokens ? "일치" : (r.totalTokens > d.totalTokens ? "+" : "") + n(r.totalTokens - d.totalTokens)) : "—"}</td>` : ""}</tr>`;
  });
  const source = state.app?.ai?.provider === "litellm" ? esc(reportError) : reported
    ? "Anthropic 집계는 이 키의 조직 전체 사용량이라, 같은 키를 다른 곳에서도 쓰면 앱 기록보다 큽니다."
    : `Anthropic 집계는 이 API 키로 조회할 수 없습니다(${esc(reportError)}). 조직용 Admin 키가 있어야 자동으로 대조되고, 지금은 Claude Console의 Cost·Usage 화면에서 같은 날짜(UTC)의 Haiku 5.5 금액과 비교하세요.`;
  return `<section class="usage-check"><h3>AI 사용량 확인 · 최근 7일(UTC)</h3>
    ${days.length ? `<table><thead><tr><th>날짜</th><th>실행</th><th>앱 기록 토큰</th><th>앱 추정 비용</th>
      ${reported ? "<th>Anthropic 집계 토큰</th><th>집계 기준 비용</th><th>토큰 차이</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>` : '<p class="small muted">아직 기록된 실행이 없습니다.</p>'}
    <p class="small muted">${recordingSince ? `실행 기록은 ${esc(recordingSince.slice(0, 16).replace("T", " "))} UTC부터 남기기 시작했습니다. ` : "실행 기록은 지금부터 남습니다. "}${source}</p></section>`;
}

// 톱니바퀴: 끄면 그 기능이 화면(작품 단계·목록 탭·내보내기)과 요약 실행에서 아예 빠진다.
export function openSettings() {
  dialog("설정", `<div class="stack settings-menu">
    <section><h3>기능</h3>
      <label class="switch-row"><input id="logic-on" type="checkbox"${logicOn() ? " checked" : ""}>
        <span><b>AI 논리점검</b><small class="muted">끄면 요약 뒤 논리점검을 하지 않고, 작품 단계·목록 탭·내보내기에서 모두 빠집니다. 이미 만든 점검 결과는 지우지 않아 다시 켜면 보입니다.</small></span></label>
    </section>
    <section><h3>설정</h3>
      <div class="actions">${button("summary-settings", "요약 설정")}${button("forms-settings", "공모 연동 설정")}${button("self-check", "운영 맥 점검")}</div>
    </section>
  </div>`);
}
export async function toggleLogic(box) {
  await api("features", { logic: box.checked });
  await sync(true);
}

export async function openSummarySettings() {
  const [info, cost] = await Promise.all([api("summary-settings"), api("haiku-cost")]);
  // 키·연결 주소·모델은 키를 등록한 브라우저(처음에는 아무 브라우저)에서 바꾼다. 저장할 때 서버가 그 설정으로 모델을 확인한다.
  const manage = info.canManageKey;
  dialog("요약 설정", `<form id="summary-config" class="stack">
    <p class="small">요약 모델 · ${summaryModel()}</p>
    <p class="small muted">${cloudScope()}</p>
    <p class="small">${info.configured ? aiLabel() + " · 서버에 저장된 키를 자동으로 사용합니다." : "API 키를 입력해 저장하면 AI 요약을 쓸 수 있습니다."}</p>
    ${manage ? `
      ${field(info.configured ? "API 키 · 바꿀 때만 입력" : "API 키", `<input type="password" name="token" maxlength="512" autocomplete="off" spellcheck="false" ${info.configured ? "" : "required"}>`)}
      ${field("연결 주소 · 회사 LiteLLM이면 입력, 비우면 Anthropic", input("aibase", info.endpoint, "url", 'maxlength="300" placeholder="https://litellm.회사주소"'))}
      ${field("모델 · 비우면 Haiku 5.5", input("aimodel", info.model === "claude-haiku-5-5" ? "" : info.model, "text", 'maxlength="100" placeholder="claude-haiku-5-5"'))}`
      : `${field("이 브라우저 연결 · 지금 등록된 API 키를 입력하면 여기서도 설정을 바꿀 수 있습니다", '<input type="password" name="token" maxlength="512" autocomplete="off" spellcheck="false" required>')}
        <input id="aibase" type="hidden" value="${esc(info.endpoint)}"><input id="aimodel" type="hidden" value="${esc(info.model)}">`}
    <div class="actions"><button class="primary">${manage ? "설정 저장" : "브라우저 연결"}</button>
    ${info.local && info.configured ? button("link-web-browser", "웹 브라우저에서 키 관리") : ""}</div></form>
    ${usageCheck(cost)}`);
}

// 공모 연동 설정: MS Forms 응답 엑셀과 첨부가 내려받아지는 OneDrive 폴더를 이 맥의 선택 창으로 고른다.
// 엑셀 열(A ID · C 완료 시간 · D 이메일 · E 이름 · G 소속 · H 제목 · I 간략 설명 · J 첨부 파일명)은 서버가 자동으로 맞춘다.
export const formsPick = { workbook: "", attachments: "" };
export async function openFormsSettings() {
  const info = await api("forms-settings");
  formsPick.workbook = info.workbook?.path ?? "";
  formsPick.attachments = info.attachments?.path ?? "";
  const source = (key, title, place, check) => `<section class="setup-step"><h3>${title}</h3><div class="source-row">
      <div><span id="${key}-label"${place ? "" : ' class="muted"'}>${esc(place?.label ?? "아직 고르지 않았습니다")}</span>
        ${check ? `<small class="${check.ok ? "ok-text" : "warn-text"}">${esc(check.text)}</small>` : ""}</div>
      <button type="button" data-action="choose-source" data-pick="${key}">찾아보기</button></div></section>`;
  dialog("공모 연동 설정", `<form id="forms-config" class="stack">
    ${info.error && !info.check ? `<p class="warn-text small">${esc(info.error)}</p>` : ""}
    ${source("workbook", "MS Forms 응답 엑셀", info.workbook, info.check?.workbook)}
    ${source("attachments", "첨부 파일 폴더", info.attachments, info.check?.attachments)}
    <p class="small muted">찾아보기를 누르면 서버 맥 화면에 선택 창이 열립니다. 엑셀의 인입일·팀·접수자·이메일·간략 설명·첨부 파일명은 열 위치로 자동으로 읽습니다.</p>
    <div class="actions"><button class="primary">설정 저장</button></div>
  </form>`);
}


// 운영 맥 점검: 첨부를 읽는 데 필요한 권한·앱을 시험 문서로 확인한다(src/self-check.mjs). 도는 동안 1.5초마다 새로 그린다.
const MARK = { ok: "✓", warn: "!", error: "✕" };
function selfCheckHtml(r) {
  const items = r.items.map((item) => `<li class="check-${item.state}"><b>${MARK[item.state]} ${esc(item.name)}</b><small>${esc(item.text)}</small>
    ${item.image === undefined ? "" : `<img src="/api/self-check-image?n=${item.image}&at=${encodeURIComponent(r.at)}" alt="${esc(item.name)}에서 읽은 첫 쪽">`}</li>`);
  const when = r.running ? `<p class="small">${esc(r.label || "운영 맥 점검")} 중…</p>`
    : r.at ? `<p class="small muted">${esc(new Date(r.at).toLocaleString("ko-KR"))}에 점검했습니다. 그림은 실제로 읽힌 첫 쪽입니다.</p>` : "";
  return `<p class="small muted">공모 첨부를 읽는 데 필요한 권한과 앱을 시험 문서로 확인합니다. 1~3분 동안 Edge·Word 등이 잠깐 열렸다 닫힙니다.</p>
    ${when}<ul class="self-check">${items.join("")}</ul>
    <div class="actions"><button type="button" class="primary" data-action="self-check-run"${r.running ? " disabled" : ""}>${r.at ? "다시 점검" : "점검 시작"}</button></div>`;
}
let watching = 0;
export async function showSelfCheck() {
  const mine = ++watching; // 대화상자를 다시 열면 앞의 새로 그리기는 멈춘다
  for (;;) {
    const report = await api("self-check");
    const body = $("self-check-body");
    if (mine !== watching || !body || !$("dialog").open) return;
    body.innerHTML = selfCheckHtml(report);
    if (!report.running) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
export function openSelfCheck() {
  dialog("운영 맥 점검", `<div id="self-check-body" class="stack"></div>`);
  return showSelfCheck();
}
