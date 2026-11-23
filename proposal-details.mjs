// Keep repairs local to the source that supports them. The long-document
// selector and table reconciler handle their respective kinds of evidence.
const compact = (s) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const proposal = /제안|건의|요청|검토해\s*주|주시기\s*바랍니다/u;
const usable = (row) =>
  row?.text && row.capture && (!row.kind || ["OCR", "원문"].includes(row.kind));
const stop = new Set(["경우", "관련", "위해", "통해", "대한", "현재", "하는", "있는", "있음", "없음"]);
function vocabulary(text) {
  return [...new Set((text.match(/[가-힣]{2,}|[A-Za-z]{2,}/gu) || [])
    .map((w) => w.replace(/(?:으로|에서|에게|까지|은|는|을|를|의|과|와|에|가)$/u, ""))
    .filter((w) => w.length >= 2 && !stop.has(w)).map(compact))];
}
const hits = (words, text) => words.filter((w) => compact(text).includes(w)).length;
const restricted = /(?:오직|예시|예를\s*들|가령|제외|생략|한정|중에서|중\s*(?:하나|둘|일부)|만\s*(?:운영|시행|실시|대상|포함|선택|해당|제공|선정|적용|수행|가능)|하지\s*않)/u;

// Match the words on both sides of a summary's existing conjunction. The
// middle member must be a short nominal item in the cited comma list.
function restoreCommaMember(text, source, cited) {
  if (restricted.test(text)) return text;
  for (const part of source.split(/(?:^|\s+)(?:\d{1,2}[.)](?!\d)|[①-⑳•·])|[!?。;\n]/u)) {
    const items = part.split(/[,，]/u);
    for (let i = 1; i + 1 < items.length; i++) {
      const middle = items[i].trim();
      if (!/^[가-힣A-Za-z]{2,}(?:\s+[가-힣A-Za-z]{1,8}){0,3}$/u.test(middle) ||
          /(?:지만|하며|하면|하여|하고|거나|는데|으로|때문에|이므로|않고|없이|만약|단지|제외|미포함|불포함|해도|인지|다면|에도|도록|에는|반면)/u.test(middle) ||
          middle.length > 24 || compact(text).includes(compact(middle))) continue;
      const left = items[i-1].trim().match(/[가-힣A-Za-z]+(?:\s+[가-힣A-Za-z]+)?$/u)?.[0];
      const right = items[i+1].trim().match(/^[가-힣A-Za-z]+(?:\s+[가-힣A-Za-z]+)?/u)?.[0];
      if (!left || !right || Math.min(compact(left).length, compact(right).length) < 3) continue;
      const flexible = (s) => [...compact(s)].join("\\s*");
      const gap = new RegExp(`(${flexible(left)})\\s*(?:및|와|과|[,，·])\\s*(${flexible(right)})`, "giu");
      if ([...text.matchAll(gap)].length === 1 && !cited.some(s => s.match(gap)))
        text = text.replace(gap, (_, a, b) => `${a}, ${middle}, ${b}`);
    }
  }
  return text;
}

// A short labelled problem often names the cause in both versions but
// spells out the actual consequences only in the original.
function restoreLabeledCause(text, source) {
  const colon = Math.max(source.lastIndexOf(":"), source.lastIndexOf("："));
  if (colon < 0 || /기대\s*효과|예시|예를\s*들|목표|가정/u.test(source.slice(0, colon))) return text;
  const body = source.slice(colon + 1).trim();
  if (body.length < 20 || body.length > 115 || /[?!;:\n]|[.。].+\S/u.test(body)) return text;
  const cause = /^(.{5,54}?(?:때문에|탓에|내려와|밀려|겹쳐|늦어져|지연돼|부족해|없어|이어서|으로\s*인해))\s*[,]?\s*(.+)$/u.exec(body);
  if (!cause || !/(?:한계|어려|불편|제약|부족|차질|부담|제한|못하|불가능)/u.test(cause[2])) return text;
  const head = vocabulary(cause[1]), tail = vocabulary(cause[2]);
  if (head.length < 2 || tail.filter(w => !compact(text).includes(w)).length < 3) return text;
  const fragments = [...text.matchAll(/[^,，.!?。;]+/gu)];
  const matches = fragments.filter(([fragment]) => {
    const words = vocabulary(fragment);
    return !restricted.test(fragment) && words.length >= 3 && hits(head, fragment) >= Math.max(2, Math.ceil(head.length * 0.6)) &&
      hits(words, source) === words.length && !/\d|["“”'‘’()]/u.test(fragment);
  });
  if (matches.length !== 1) return text;
  const match = matches[0], end = match.index + match[0].length;
  // Only replace a standalone first statement. If a preceding clause frames
  // an example, condition, or quotation, it also scopes the following words.
  if (match.index !== 0) return text;
  const rest = text.slice(end).replace(/^[,，.。]\s*/u, "").trim();
  return body.replace(/[.。]$/u, "") + "." + (rest ? " " + rest : "");
}

const numbered = /(?:^|\s+)(?:\d{1,2}[.)](?!\d)|[①-⑳]|[ivx]{1,4}\.(?=[\s가-힣]))\s*/iu;
const bullet = /(?:^|\s+)[·•]\s*/u;
function missingSequence(text, source) {
  if (restricted.test(text) || /\d/.test(text.replace(/(?:^|\s+)\d{1,2}[.)](?!\d)/gu, " ")) ||
      !/(?:작동\s*흐름|처리\s*절차|진행\s*순서|운영\s*순서|작업\s*순서)/u.test(source)) return text;
  const steps = source.split(numbered).slice(1);
  if (steps.length < 3 || steps.length > 6 || source.length > 120 ||
      !steps.every(s => s.trim() && !/[()“”"‘’?!]/u.test(s))) return text;
  const tokens = steps.map(vocabulary);
  const unique = tokens.map((words, i) => words.filter(w =>
    tokens.every((other, j) => i === j || !other.includes(w))));
  const covered = unique.map(ws => ws.length > 0 && hits(ws, text) >= Math.min(2, ws.length));
  if (!covered[0] || !covered.at(-1) || hits(vocabulary(text), source) !== vocabulary(text).length) return text;
  return unique.slice(1, -1).some((ws, i) => ws.length >= 2 && !covered[i+1] && hits(ws, text) === 0)
    ? source : text;
}

const request = /(?:검토|시행|실시|도입|적용|운영|지원|반영|확대|신설|설치|마련|허용).{0,30}(?:요청|건의|바랍니다|좋겠습니다|부탁|주십시오|주세요)/u;
const scopes = /(?:작은|좁은|제한된|한정된|일부|소수|최소한의)\s*(?:범위|규모|대상|구역|인원|부서|지역|기간)|(?:소규모|한시적|한시)으로|(?:\d+|한|두|세)\s*(?:개\s*(?:팀|지점|부서|지역)|(?:명|개월)\s*(?:한도|이내|동안))/u;
const contextual = /가정(?:하면|하에|한)|(?:나쁜|잘못된)\s*(?:예|사례)|반면|(?:제외|금지)\s*(?:사항|대상)|예시\s*[:：]|예를\s*들|가령|검토\s*(?:보류|중단)|하지\s*않|해서는\s*안/u;
function extraDetails(row) {
  const source = row.text.trim();
  if (contextual.test(source) || /(?:https?:\/\/|[\w.+-]+@[\w.-]+)/u.test(source)) return [];
  const scope = scopes.exec(source)?.[0];
  if (scope && source.length <= 110 && request.test(source) && !/[.。?!].+\S/u.test(source)) {
    return [{ text: source, topic: "제안 내용", terms: [scope] }];
  }
  // Ordered alternatives must come from one bounded step, including its
  // subject/condition. Do not detach a step from a conditional parent.
  const details = [];
  for (const block of source.split(bullet)) {
    const [heading, ...steps] = block.split(numbered);
    if (steps.length < 2 || /(?:경우|한해|조건|시에는|이라면|일\s*때|제외|예시)/u.test(heading)) continue;
    for (const s of steps) {
      const text = s.trim(), options = text.split(/\s+(?:또는|혹은)\s+/u);
      if (options.length !== 2 || text.length < 12 || text.length > 88) continue;
      const left = options[0].match(/[가-힣]+(?:\s+[가-힣]+)?$/u)?.[0];
      const right = options[1].match(/^[가-힣]{2,}(?:\s+[가-힣]{2,})?/u)?.[0];
      if (left && right) details.push({ text, topic: "이용·운영 방식", terms: [left, right] });
    }
  }
  return details;
}

function adjacent(entries, id, offset) {
  const match = /^(.*\.)(\d+)$/u.exec(id);
  if (!match) return null;
  const target = match[1] + (Number(match[2]) + offset);
  const index = entries.findIndex(([key]) => key === id);
  const next = entries[index + offset];
  return index >= 0 && next?.[0] === target && usable(next[1]) &&
    entries[index][1].capture === next[1].capture ? { id: target, text: next[1].text } : null;
}
const sentences = text => text.split(/(?<=[다됨함음임짐])[.。](?!\d)\s*|[!?。]\s*/u).map(s => s.trim()).filter(Boolean);
const verification = /([가-힣A-Za-z]{2,18})(?:에서|이|가)\s*(확인|인증|검증|승인)(?:한|해\s*준|을\s*거친|받은)/u;
const coordinated = /[가-힣]{2,}(?:\s*[·ㆍ]\s*[가-힣]{2,})+\s+(?:[가-힣]{1,8}(?:인|자|원|층)|직원|주민|학생)[이가은는을를도만\s]/u;
const cadence = /(?:매(?:년|월|주|일|달)|(?:분기|반기|연도|월|주|일)별)(?:로|마다)?/u;
const witness = /(?:직접\s*)?목격(?:함|했다|했음|하였다|하였음)[.]?$/u;
const perUnit = /(?:[가-힣]{1,10}(?:마다|당)|(?:각|매)\s*[가-힣]{1,8}에)\s*(?:약\s*)?\d[\d,.]*\s*(?:개|명|대|건|권|세트|장|원|회|곳|대씩)/u;
const closed = /(?:했|하였|됐|되었|이미|실제로\s*완료)/u;
const conditionalRate = /(?:경우|[으다라]면|면|때(?:에는|만)?|에\s*한해|에\s*한하여|조건|전제|한정|제외|\s시)(?:에만|에는|에)?(?=[,，:\s]|$)/u;
function objectOfVerification(text, match) {
  return text.slice(match.index + match[0].length).trim().match(/^[가-힣A-Za-z]{2,}/u)?.[0]
    .replace(/(?:으로|에서|에게|만|이|가|은|는|을|를)$/u, "");
}
function repairRolesAndScope(p, entries, evidence) {
  const linked = p.refs.filter(id => usable(evidence[id])).map(id => ({ id, text: evidence[id].text }));
  const rows = linked.flatMap(({id, text}) => sentences(text).map(s => ({id, text: s})));
  const extract = (text, refs) => ({ ...p, text, refs, mode: "원문 발췌" });
  const actor = verification.exec(p.text);
  if (actor && !rows.some(r => {
    const a = verification.exec(r.text);
    return a?.[1] === actor[1] && a[2] === actor[2];
  })) {
    const object = objectOfVerification(p.text, actor);
    const alternatives = rows.filter(r => {
      const original = verification.exec(r.text);
      return object && original?.[2] === actor[2] && object === objectOfVerification(r.text, original);
    });
    if (alternatives.length === 1) {
      const r = alternatives[0], text = r.text.replace(/^(?:하지만|또한|그리고)\s+/u, "");
      const next = adjacent(entries, r.id, 1);
      if (/(?:때문에|이므로|하므로)[,，]?$/u.test(text) && next && next.text.length < 68 &&
          /(?:있습니다|있다|있음)[.]?$/u.test(next.text) && text.length + next.text.length < 145)
        return extract(text + " " + next.text, [r.id, next.id]);
      if (text.length < 115 && /(?:합니다|습니다|한다|된다|한다는|했음|해야\s*함)[.]?$/u.test(text))
        return extract(text, [r.id]);
    }
  }
  // Where the author describes concrete ability and actions, a generated
  // list of beneficiary types can introduce a new, unsupported category.
  const group = coordinated.exec(p.text);
  if (group) {
    const names = group[0].split(/\s+/u)[0].split(/[·ㆍ]/u);
    const source = compact(linked.map(r => r.text).join(" "));
    const alternatives = rows.filter(r => r.text.length <= 115 && /(?:사람|분들|친구|직원|주민|학생|이용자)(?:들도|도)\s*.{1,36}(?:거나|또는)\s*.{1,36}(?:수\s*있게|수\s*있도록)/u.test(r.text));
    if (names.every(name => !source.includes(compact(name))) && alternatives.length === 1) {
      const r = alternatives[0], prefix = p.text.slice(0, group.index).trim();
      if (prefix.length < 48 && /(?:고려하여|감안하여|고려해)$/u.test(prefix) &&
          rows.some(other => other.id !== r.id && hits(vocabulary(prefix), other.text) >= 2))
        return { ...p, text: prefix + " " + r.text.replace(/[.。]?$/u, ".") };
      return extract(r.text.replace(/[.。]?$/u, "."), [r.id]);
    }
  }
  // Rebind a schedule to the verb in its own evidence row. The other
  // operation keeps its object and must have its own adjacent source.
  const freq = cadence.exec(p.text);
  if (freq) {
    const pair = /^\s*(.{1,30}?)\s+(산출|집계|수집|측정|작성|계산|정산)\s*(?:및|후|하고|하여)\s*/u.exec(p.text.slice(freq.index + freq[0].length));
    const timed = rows.filter(r => compact(r.text).startsWith(compact(freq[0])) && r.text.length < 115);
    if (pair && timed.length === 1 && !timed[0].text.includes(pair[2]) && /공개|공표|게시|발표|제출|배포|통보/u.test(timed[0].text) &&
        compact(timed[0].text).includes(compact(pair[1])) && !contextual.test(timed[0].text)) {
      const production = linked.filter(r => r.id !== timed[0].id).flatMap(r => [r, adjacent(entries, r.id, -1)])
        .filter(r => r && r.text.length < 110 && r.text.includes(pair[2]) && !cadence.test(r.text) && !contextual.test(r.text));
      const ids = [...new Set(production.map(r => r.id))];
      if (ids.length === 1 && new Set([...p.refs, ...ids]).size <= 4) {
        const prefix = p.text.slice(0, freq.index).trim();
        return { ...p, text: (prefix ? prefix + " " : "") + pair[1].trim() + " " + pair[2] + ". " + timed[0].text,
          refs: [...new Set([...p.refs, ...ids])] };
      }
    }
  }
  const recipient = /([가-힣A-Za-z]{2,18})(?:으)?로부터(?=\s.{1,65}(?:요청|건의))/u.exec(p.text);
  if (recipient && linked.some(r => compact(r.text).includes(recipient[1] + "가") &&
        /(?:주셨으\s*면|주시기를|주기를|주세요|해\s*주시기)/u.test(r.text)))
    return { ...p, text: p.text.replace(recipient[0], recipient[1] + "에") };
  if (witness.test(p.text) && !linked.some(r => /목격|직접\s*(?:보았|봤)/u.test(r.text))) {
    const experiences = rows.filter(r => r.text.length <= 105 && /(?:마주하|겪[는게었]|맞닥뜨)/u.test(r.text) && hits(vocabulary(p.text), r.text) >= 3);
    if (experiences.length === 1) return extract(experiences[0].text + ".", [experiences[0].id]);
  }
  // Keep the location denominator attached to its quantity, even when the
  // same number also counts locations in a different sentence.
  for (const r of rows) {
    const rate = perUnit.exec(r.text);
    if (!rate || compact(p.text).includes(compact(rate[0])) || r.text.length > 155 || contextual.test(r.text) ||
        conditionalRate.test(r.text.slice(0, rate.index))) continue;
    const finish = /(제작|설치|구매|배치|구축|도입|제공|운영|지급)됨[.]?$/u.exec(p.text);
    const clause = r.text.slice(rate.index);
    if (finish && hits(vocabulary(p.text), r.text) >= 3 && r.text.slice(0, rate.index).includes(finish[1] + "하며") &&
        /함$/u.test(clause) && !closed.test(r.text) && clause.length < 55)
      return { ...p, text: p.text.slice(0, finish.index) + finish[1] + "하며, " + clause.replace(/함$/u, "하는 방안이다.") };
  }
  // An arrow inside an expected-effects section describes the author's
  // expectation. A neighbouring observed-results section scopes its own rows.
  if (linked.length === 1 && linked[0].text.includes("→") && !closed.test(linked[0].text) &&
      !/기대|예상|전망|목표|가능|수\s*있/u.test(p.text)) {
    const end = /(향상|촉진|확산|강화|감소|증가|제고|개선|해소|절감|확대)[.]?$/u.exec(p.text);
    if (end && linked[0].text.split("→").at(-1).includes(end[1])) {
      for (let i = -1; i >= -4; i--) {
        const prev = adjacent(entries, linked[0].id, i);
        if (!prev) break;
        if (/^(?:[\d.)\s]+)?(?:기대|예상)\s*효과\s*$/u.test(prev.text))
          return { ...p, text: p.text.slice(0, end.index) + end[1] + ((end[1].at(-1).charCodeAt(0) - 0xac00) % 28 ? "을" : "를") + " 기대함.",
            refs: [prev.id, ...p.refs] };
        if (/^[\d.)\s]+[가-힣]|(?:결과|성과|실측|현황)\s*$/u.test(prev.text)) break;
      }
    }
  }
  return p;
}

function missingUnitCount(points, entries) {
  for (const [id, row] of entries) {
    if (!usable(row) || !points.some(p => p.refs.includes(id)) || contextual.test(row.text)) continue;
    const previous = adjacent(entries, id, -1);
    for (const sentence of sentences(row.text)) {
      const rate = perUnit.exec(sentence);
      if (!rate || conditionalRate.test(sentence.slice(0, rate.index)) ||
          (row.text.startsWith(sentence) && previous && !/[.。?!]$/u.test(previous.text) && conditionalRate.test(previous.text)) ||
          rate.index > 0 && !/[,，]\s*$/u.test(sentence.slice(0, rate.index)) ||
          points.some(p => compact(p.text).includes(compact(rate[0])))) continue;
      const text = sentence.slice(rate.index);
      if (text.length <= 62 && !/[!?:：;]/u.test(text) &&
          /(?:비치|제공|배치|설치|구매|배분|지급|지원|보관|대여|할당)(?:함|한다|합니다|할\s*예정)$/u.test(text))
        return { text, refs: [id], mode: "원문 발췌", topic: "수치·일정·자원" };
    }
  }
  return null;
}

// A form may put a whole budget label, including 'estimated', above a
// currency-only cell. Both contiguous rows constitute the evidence.
function missingCost(points, entries) {
  const money = /^(?:약\s*)?\d[\d,]*(?:\.\d+)?\s*(?:천|만|백만|천만|억)?\s*원$/u;
  const costs = entries.flatMap(([id, row]) => {
    if (!usable(row) || !/^(?:(?:총|추정|예상|소요|연간)\s*)?(?:사업비|예산|예산액|소요\s*비용|운영비)(?:\s*[(（](?:추정|예상|안)[)）])?\s*[:：]?$/u.test(row.text)) return [];
    if (/(?:예시|지난해|전년|기존|참고용)\s*[:：]?$/u.test(adjacent(entries, id, -1)?.text || "")) return [];
    const value = adjacent(entries, id, 1);
    return value && money.test(value.text.trim()) ? [{ label: row.text.trim(), value, id, page: row.capture }] : [];
  });
  if (costs.length !== 1) return null;
  const { label, value, id, page } = costs[0];
  const onPage = points.filter(p => p.refs.some(ref => entries.some(([key, r]) => key === ref && r.capture === page)));
  if (!onPage.length || onPage.some(p => /(?:사업비|예산|비용|운영비)/u.test(p.text) && /\d[\d,.]*\s*(?:천|만|백만|천만|억)?\s*원/u.test(p.text))) return null;
  return { text: label + " " + value.text.trim(), refs: [id, value.id], mode: "원문 발췌", topic: "수치·일정·자원" };
}

export function preserveProposalDetails(points, evidence) {
  if (!points?.length || !evidence || points.some(p => p.mode?.startsWith("표의 "))) return points;
  const entries = Object.entries(evidence);
  if (entries.length > 32 || new Set(entries.map(([, r]) => r.capture)).size > 3 ||
      entries.reduce((n, [, r]) => n + (r.text?.length || 0), 0) > 5500 ||
      !(entries.some(([, r]) => usable(r) && proposal.test(r.text)) ||
        (entries.some(([, r]) => usable(r) && /^사업\s*내용$/u.test(r.text)) &&
         entries.some(([, r]) => usable(r) && /^(?:사업\s*위치|사업비|필요성)/u.test(r.text))))) return points;
  const revised = points.map(p => {
    if (p.mode !== "요약" || !p.refs?.length) return p;
    const cited = p.refs.map(id => evidence[id]).filter(usable).map(r => r.text);
    let text = p.text;
    for (const id of p.refs) {
      const row = evidence[id];
      if (!usable(row) || contextual.test(row.text)) continue;
      text = restoreCommaMember(text, row.text, cited);
      text = restoreLabeledCause(text, row.text);
      if (p.refs.length === 1) {
        const sequence = missingSequence(text, row.text);
        if (sequence !== text) return { ...p, text: sequence, mode: "원문 발췌" };
      }
    }
    return repairRolesAndScope(text === p.text ? p : { ...p, text }, entries, evidence);
  });
  const candidates = entries.flatMap(([id, row], i) => {
    const previous = entries[i-1]?.[1];
    if (!usable(row) || (previous?.capture === row.capture &&
        /(?:예시|반대\s*의견|제외\s*대상|경우|시에는|에\s*한해|라면|다면)\s*[,，:：]?$/u.test(previous.text))) return [];
    return extraDetails(row).map(detail => ({ ...detail, id, page: row.capture }));
  });
  const prior = revised.filter(p => p.mode === "원문 발췌" && p.refs.length === 1 &&
    candidates.some(c => c.id === p.refs[0] && c.text === p.text));
  let budget = 2 - prior.length;
  for (const { id, text, topic, terms, page } of candidates) {
    if (budget <= 0) break;
    const neighbors = revised.filter(p => p.refs?.some(ref => evidence[ref]?.capture === page));
    const count = (p) => hits(terms.map(compact), p.text);
    if (neighbors.some(p => count(p) === terms.length)) continue;
    const words = vocabulary(text);
    if (!neighbors.some(p => hits(words, p.text) >= 2)) continue;
    const ranked = neighbors.map(p => ({ p, score: hits(words, p.text) }))
      .filter(({p, score}) => terms.length === 1 ? score >= 2 : count(p) > 0)
      .sort((a, b) => b.score - a.score || Number(b.p.topic === topic) - Number(a.p.topic === topic));
    if (!ranked.length) continue;
    revised.splice(revised.indexOf(ranked[0].p) + 1, 0, { text, topic, refs: [id], mode: "원문 발췌" });
    budget--;
  }
  const cost = missingCost(revised, entries);
  if (cost) revised.push(cost);
  // Once a numeric excerpt was surfaced, re-editing must not reveal another
  // one each time for a long list of similar unit prices or allocations.
  if (!revised.some(p => p.mode === "원문 발췌" && p.topic === "수치·일정·자원" && perUnit.test(p.text))) {
    const quantity = missingUnitCount(revised, entries);
    if (quantity) revised.push(quantity);
  }
  return revised.length === points.length && revised.every((p, i) => p === points[i]) ? points : revised;
}
