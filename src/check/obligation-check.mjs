import { compactLower as compact } from "../text.mjs";
const sentences = s => s.split(/[.!?。！？;\n]/u).map(x => x.trim()).filter(Boolean);
const noun = /^[가-힣A-Za-z0-9]+(?:\s+[가-힣A-Za-z0-9]+){0,4}$/u;
const multiple = /[,，·ㆍ/]|\s(?:및|또는|혹은|아니면)\s|(?:과|와)\s|(?:이?나)\s/u;
const conditional = /(?:경우|일\s*때|할\s*때|하[면는]\s*경우|라면|하면|다면|한해|한하여|제외|예외|대신|단지|예시|가령|예컨대|적용\s*시|(?:제출|접수|신청|요청|발생)\s*시|하지\s*않|아닌|아니라)/u;
const negated = /^\s*(?:하지(?:는)?\s*(?:않|말|아니)|할\s*(?:지|필요\s*없|경우|때)|하는\s*(?:경우|때)|한다면|(?:를|가|에|는)?\s*(?:하지(?:는)?\s*않|보류|금지|반대|철회|해제|폐지|완화|검토|불필요|예외|대신|여부|아니|아님)|할\s*수\s*없)/u;
const scopeEnding = /(?:와의|과의|에서는|에게는|으로는|에서|에게|에는|은|는|이|가)$/u;

function pair(sentence, disjunctive) {
  const start = sentence.indexOf("의무화");
  if (start < 0 || sentence.indexOf("의무화", start + 3) >= 0 ||
      negated.test(sentence.slice(start + 3))) return null;
  const prefix = sentence.slice(0, start).trim();
  if (conditional.test(prefix) || /[,，:：()（）“”"‘’]/u.test(prefix)) return null;
  const join = disjunctive ? /(?:이나|나)\s+|\s+(?:또는|혹은)\s+/gu : /\s+및\s+/gu;
  const separators = [...prefix.matchAll(join)];
  if (separators.length !== 1) return null;
  const separator = separators[0];
  const before = prefix.slice(0, separator.index).trim();
  const right = prefix.slice(separator.index + separator[0].length).trim().replace(/[을를]$/u, "");
  if (!noun.test(right) || multiple.test(before) || multiple.test(right)) return null;
  const words = before.split(/\s+/u);
  let split = 0;
  for (let i = 0; i < words.length - 1; i++)
    if (scopeEnding.test(words[i])) split = i + 1;
  const scope = words.slice(0, split).join(" "), left = words.slice(split).join(" ");
  if (!noun.test(left) || [left,right].some(s => compact(s).length < 2) || compact(left) === compact(right)) return null;
  // 고른 인용 구절은 요약이나 원문에 글자 그대로 있어야 한다.
  const rawLeft = [...before.matchAll(/\S+/gu)][split];
  const quote = sentence.slice(rawLeft.index, start + 3);
  return { left: compact(left), right: compact(right), scope, quote };
}

function sameSubject(a,b) {
  if (compact(a) === compact(b)) return true;
  // 두 절이 같은 상대(여러 낱말)를 분명히 가리킨다. 한쪽은 문서의 더 긴 설명으로 그 상대를 소개할 수도 있다.
  if (![a,b].every(s => /(?:와의|과의)$/u.test(s) && s.split(/\s+/u).length >= 2)) return false;
  const [short,long] = [a,b].sort((x,y) => x.length-y.length);
  return long.endsWith(" " + short);
}

export function checkStrengthenedObligation(point, evidence) {
  if (!point?.id || typeof point.text !== "string" || !point.refs?.length || !evidence) return [];
  const citations = [];
  for (const id of new Set(point.refs)) {
    const row = evidence[id];
    if (typeof row?.text !== "string" || row.kind && !["OCR","원문"].includes(row.kind)) return [];
    for (const sentence of sentences(row.text)) citations.push({ id, sentence });
  }
  const findings = [];
  for (const summary of sentences(point.text)) {
    const both = pair(summary, false);
    if (!both) continue;
    const alternatives = citations.filter(({sentence}) => {
      const either = pair(sentence, true);
      return either && either.left === both.left && either.right === both.right && sameSubject(either.scope, both.scope);
    });
    if (alternatives.length !== 1) continue;
    const matching = alternatives[0];
    const otherRequirements = citations.filter(c => c !== matching &&
      /의무|필수|요구|반드시|해야\s*(?:한다|함|합니다)/u.test(c.sentence));
    if ([both.left,both.right].every(term => otherRequirements.some(c => compact(c.sentence).includes(term)))) continue;
    const original = pair(matching.sentence, true);
    findings.push({
      status: "확인 필요", type: "요약과 원문 불일치", method: "선택 의무와 동시 의무 대조",
      reason: "원문은 두 수단 중 하나를 의무화하는데 요약은 두 수단을 함께 의무화한다고 표현합니다. 적용 범위를 확인하세요.",
      claim: { id: point.id, quote: both.quote }, contrast: { id: matching.id, quote: original.quote },
      refs: [matching.id],
    });
  }
  return findings;
}
