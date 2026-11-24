// 글자 비교용 도우미

// 전각·호환 문자를 맞추고(NFKC) 공백을 지운다. 요약 문장과 원문을 글자로 대조할 때 쓴다.
export const compact = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/gu, "");
// 대소문자도 무시한다.
export const compactLower = (s) => compact(s).toLowerCase();
// 회사 이름 오타를 바로잡는다(OCR·AI·엑셀 어디서 왔든 저장할 때 고친다). [틀린 표기, 바른 표기]
export const NAME_FIXES = [["빗섬", "빗썸"], ["비썸", "빗썸"]];
export const fixNames = (s) => NAME_FIXES.reduce((t, [wrong, right]) => t.replaceAll(wrong, right), String(s));
// 중복을 뺀 배열(처음 나온 순서 유지)
export const uniq = (xs) => [...new Set(xs)];
