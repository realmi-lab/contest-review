// 요청 오류와 입력 확인

// 화면에 보여 줄 오류를 HTTP 상태와 함께 던진다.
export function err(msg, status = 400) {
  throw Object.assign(new Error(msg), { status });
}

// max 글자 이하의 문자열인지 확인하고 앞뒤 공백을 지운다.
export function bounded(x, max) {
  if (typeof x !== "string" || x.length > max) err("입력 길이를 확인하세요.");
  return x.trim();
}

// 쪽수: 비어 있으면 null, 아니면 1~2000의 정수
export function integer(x) {
  if (x === null || x === undefined || x === "") return null;
  if (!Number.isInteger(x) || x < 1 || x > 2000) err("쪽수는 1~2000의 정수입니다.");
  return x;
}

// 인입 날짜(YYYY-MM-DD)가 실제 있는 날짜인지 확인한다. 빈 값은 그대로 둔다.
export function day(value) {
  const text = bounded(value, 10);
  if (!text) return "";
  const parsed = new Date(text + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith("0000") ||
      !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text)
    err("인입 날짜를 확인하세요.");
  return text;
}
