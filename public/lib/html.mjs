// 화면 조각을 만들 때 쓰는 공용 도구 (app.js · interactions.mjs · 채점 결과 파일의 review.mjs)
const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const join = (items, fn) => items.map(fn).join("");
// 요약 문장을 한 문장씩 나눈다. 마침표 뒤에 빈칸이 있을 때만 끊어 0.45 같은 소수는 그대로 둔다.
export const noPeriod = (text) => String(text).replace(/\.$/, ""); // 끝 마침표만(0.398 같은 소수점은 그대로). 요약 줄은 개조식이라 점 없이 보여 준다
export const sentences = (text) => String(text ?? "").split(/(?<=[.!?])\s+(?=\S)/u);
// 문장 속 수치(단위·범위 포함)를 <mark class="num">으로 감싼다. 영문·숫자에 붙은 숫자(f1, S2.9)와 &#39; 같은 문자 참조는 건드리지 않는다.
// '모델 1', '1차'처럼 번호로 쓴 한 자리 숫자는 두고, 단위·소수·범위가 있거나 두 자리 이상인 값만 표시한다.
const NUMBER = /(?<![\w.&#])\d(?:[\d,.]*\d)?(?:\s?[~∼–-]\s?\d(?:[\d,.]*\d)?)?(?:%p|%|퍼센트|배|명|건|개월|개|년|월|일|주|시간|분|초|만\s?원|억\s?원|천\s?원|원|만|억|점|위|곳|회|대|가지)?/gu;
const measured = (m) => /[.,~∼–-]|\D$/.test(m) || /^\d{2}/.test(m);
export const markNumbers = (text) => esc(text).replace(NUMBER, (m) => (measured(m) ? `<mark class="num">${m}</mark>` : m));
// 확정 시각 표기: "2026-11-22 10:30" (서울 시간)
export const seoulMinute = (iso) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
