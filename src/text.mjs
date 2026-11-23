// 글자 비교용 도우미

// 전각·호환 문자를 맞추고(NFKC) 공백을 지운다. 요약 문장과 원문을 글자로 대조할 때 쓴다.
export const compact = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/gu, "");
// 대소문자도 무시한다.
export const compactLower = (s) => compact(s).toLowerCase();
// 중복을 뺀 배열(처음 나온 순서 유지)
export const uniq = (xs) => [...new Set(xs)];
