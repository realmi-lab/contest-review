/* ─────────────────────────── 입체감과 움직임 ───────────────────────────
   원문은 손에 잡히는 종이처럼 들려 올라온다. 평가자의 일은 요약과 원문을 대조하는 것이라
   움직임은 그 연결(어느 쪽, 어느 줄)과 상태 변화(단계·작품 이동, 점수, 확정)를 설명하는 데만 쓴다.
   - transition: 작품을 바꾸면 시험지를 넘기고, 단계를 바꾸면 같은 장 안에서 민다.
   - evidencePeek: 근거 쪽 칩(예: 27쪽)에 머물면 그 쪽의 인용 부분을 종이 카드로 띄운다.
   - tiltPages: 요약 옆 원문 썸네일이 포인터 쪽으로 살짝 기운다.
   - tween: 숫자를 바뀐 값까지 부드럽게 센다.
   움직임 줄이기 설정이면 이동·기울기는 빼고 투명도와 색 변화만 남긴다(style.css). */
import { esc } from "./html.mjs";
import { evidenceCrop } from "./expanded-reading.mjs";

const calm = matchMedia("(prefers-reduced-motion: reduce)");

// 화면을 다시 그리되 View Transitions로 넘긴다. direction: into(목록→작품) · back · turn-next·turn-prev(시험지 넘김) · next·prev(단계).
// 다 그린 뒤에 끝나는 약속을 돌려준다(새 화면의 요소에 포커스를 줄 때 기다린다).
export function transition(draw, direction) {
  if (!document.startViewTransition || document.hidden) {
    draw();
    return Promise.resolve();
  }
  const root = document.documentElement;
  root.dataset.nav = direction;
  const moving = document.startViewTransition(draw);
  moving.finished.finally(() => {
    if (root.dataset.nav === direction) delete root.dataset.nav;
  });
  return moving.updateCallbackDone;
}

// 근거 미리보기. lookup(근거 id) → { evidence, capture } 또는 null.
// 돌려주는 hide()는 화면을 다시 그릴 때 불러 남은 카드를 닫는다.
export function evidencePeek(lookup) {
  const card = document.createElement("div");
  card.id = "peek";
  card.className = "peek";
  card.setAttribute("role", "tooltip");
  card.hidden = true;
  document.body.append(card);
  let timer = 0, chip = null;

  function show(target) {
    const found = lookup(target.dataset.ref);
    if (!found) return;
    hide();
    chip = target;
    card.innerHTML = peekHtml(found, target.textContent);
    card.hidden = false;
    place(card, target);
    target.setAttribute("aria-describedby", card.id);
    requestAnimationFrame(() => card.classList.add("open"));
  }
  function hide() {
    clearTimeout(timer);
    chip?.removeAttribute("aria-describedby");
    chip = null;
    card.classList.remove("open");
    card.hidden = true;
  }
  const chipOf = (node) => node?.closest?.(".ref[data-ref]");
  document.addEventListener("pointerover", (e) => {
    const target = chipOf(e.target);
    if (!target || target === chip) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(target), 220); // 지나가기만 할 때는 띄우지 않는다
  });
  document.addEventListener("pointerout", (e) => {
    const target = chipOf(e.target);
    if (target && !target.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const target = chipOf(e.target);
    if (target && target.matches(":focus-visible")) show(target);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === chip) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  document.addEventListener("click", hide, true); // 눌러서 원문 패널을 열면 미리보기는 닫는다
  window.addEventListener("scroll", hide, true);
  return { hide };
}

const PEEK_WIDTH = 316; // 카드 안쪽 너비(px). style.css의 .peek 너비와 맞춘다.
function peekHtml({ evidence, capture }, label) {
  const crop = evidenceCrop(capture, evidence);
  let picture = "";
  if (crop) {
    const [, , w, h] = crop.viewBox;
    const height = Math.round(Math.min(200, (PEEK_WIDTH * h) / w));
    const marks = crop.boxes.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"/>`).join("");
    picture = `<svg viewBox="${crop.viewBox.join(" ")}" preserveAspectRatio="xMidYMin slice" style="height:${height}px" aria-hidden="true">
      <image href="/api/image/${esc(capture.id)}" width="${capture.ocrWidth}" height="${capture.ocrHeight}"/>${marks}</svg>`;
  }
  return `<div class="peek-head"><b>${esc(label)}</b><span>${esc(capture?.document || "")}</span></div>
    ${picture}<p>${esc(evidence.text)}</p><small>눌러서 원문 패널에서 보기</small>`;
}

// 칩 아래(자리가 없으면 위)에 카드를 두고, 칩에서 자라나오도록 기준점을 칩에 맞춘다.
function place(card, target) {
  const r = target.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight, gap = 10, edge = 12;
  const below = r.bottom + gap + h <= innerHeight - edge;
  const top = Math.max(edge, below ? r.bottom + gap : r.top - gap - h);
  const left = Math.min(Math.max(edge, r.left + r.width / 2 - w / 2), innerWidth - w - edge);
  card.style.left = left + "px";
  card.style.top = top + "px";
  card.style.transformOrigin = `${Math.round(r.left + r.width / 2 - left)}px ${below ? 0 : h}px`;
}

// 원문 썸네일(selector)이 포인터 쪽으로 살짝 기울고 빛이 따라온다. 기울기는 CSS 변수로만 넘긴다.
export function tiltPages(selector) {
  document.addEventListener("pointermove", (e) => {
    const page = e.target.closest?.(selector);
    if (!page || calm.matches) return;
    const r = page.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    page.style.setProperty("--tilt-x", (-y * 6).toFixed(2) + "deg");
    page.style.setProperty("--tilt-y", (x * 8).toFixed(2) + "deg");
    page.style.setProperty("--light-x", Math.round((x + 0.5) * 100) + "%");
    page.style.setProperty("--light-y", Math.round((y + 0.5) * 100) + "%");
  });
  document.addEventListener("pointerout", (e) => {
    const page = e.target.closest?.(selector);
    if (page && !page.contains(e.relatedTarget)) for (const name of ["--tilt-x", "--tilt-y"]) page.style.removeProperty(name);
  });
}

// el의 숫자를 to까지 0.26초 동안 센다(소수 digits자리). 연달아 바뀌면 마지막 값으로 간다.
export function tween(el, to, digits = 1) {
  const from = Number(el.dataset.value ?? el.textContent) || 0;
  const run = (el.dataset.run = String(Number(el.dataset.run || 0) + 1));
  el.dataset.value = to;
  if (calm.matches || from === to) {
    el.textContent = to.toFixed(digits);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    if (el.dataset.run !== run) return;
    const t = Math.min(1, (now - start) / 260);
    el.textContent = (from + (to - from) * (1 - (1 - t) ** 3)).toFixed(digits);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
