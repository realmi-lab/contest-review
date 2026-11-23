const mode = "자격·선발 원문";
const compact = s => s.normalize("NFKC").replace(/\s+/gu, "");
const readable = r => r?.capture && r.text && (!r.kind || ["원문", "OCR"].includes(r.kind));
const eligibility = /(?:지원|모집|신청|선발|응시|참여|변경\s*후|개정\s*후)\s*(?:자격|요건|기준)|자격\s*(?:요건|기준)/u;
const preference = /가산점|가점|우대|우선\s*선발/u;
const change = /현행|기존|변경|개정|신설|폐지|완화|확대|개편/u;
const concrete = /\d|인정|확인|재학|이수|보유|소지|경력|졸업|이상|이하|미만|초과|삭제|국적|자격증/u;
const detail = (role, text, refs) => ({
  topic: role === "quota" ? "수치·일정·자원" : "이용·운영 방식",
  text, refs: [...new Set(refs)], mode, eligibilityRole: role,
});
const marker = /(?:^|\s+)([□■▣]|[ㅇ○●◦•]|[-–](?=[가-힣（(])|[①-⑳]|\d{1,2}[.)](?!\d|\s*[%원]))\s*/gu;
const period = /(?:연간|매년|월간|분기별|연도별|반기별|매월)/u;
const quota = /((?:(?:연간|매년|월간|분기별|연도별|반기별|매월)\s*)?(?:(?:모집|선발|지원|수혜|예산)\s*(?:규모|정원|인원|금액)|사업비|지원금|예산|정원|인원)(?:[을를은는이가])?\s*(?:기존\s*)?(?:\d[\d,.]*\s*(?:명|팀|원|개|건)에서\s*)?(?:총\s*)?(\d[\d,.]*\s*(?:억\s*원|만\s*원|천\s*원|원|명|팀|자리|개|건))\s*(?:으로|로|까지)\s*(?:증원|증액|확대|상향|늘[려리림]|인상))/u;
function quotaChange(text, value, source) {
  const [digits, unit] = value.match(/[\d,.]+|[가-힣]+/gu);
  const literal = "(?<![\\d,.])" + [...digits].map(c => c === "." ? "\\." : c).join("") + "\\s*" + [...value.slice(value.indexOf(unit)).replace(/\s+/gu, "")].join("\\s*");
  // If the same source gives an increment too, its amount is already
  // qualified independently and a bare number is ambiguous.
  if (new RegExp(literal + "\\s*(?:더|추가|씩|증원|증액)").test(source)) return text;
  const particle = source.match(new RegExp(literal + "\\s*(으로|로|까지)"))?.[1];
  if (!particle) return text;
  return text.replace(new RegExp(`(${literal})\\s*(증원|증액|상향|확대|인상)`, "gu"), "$1" + particle + " $2")
    .replace(new RegExp(`(${literal})\\s*(?:더|추가)\\s*(모집|선발|지원|배정|편성)`, "gu"), particle === "까지" ? "$1까지 $2" : "총 $1 $2");
}
function units(text) {
  const matched = [...text.matchAll(marker)], result = [];
  const push = (mark, body) => {
    body = body.split(/<[^<>]{1,20}>/u)[0].trim();
    if (body) result.push({ mark, body });
  };
  push("", text.slice(0, matched[0]?.index ?? text.length));
  for (let i = 0; i < matched.length; i++) {
    const m = matched[i];
    push(m[1], text.slice(m.index + m[0].length, matched[i+1]?.index ?? text.length));
  }
  return result;
}
function candidates(entries) {
  const facts = [], quotas = [], groups = [];
  let section = "", page, previous, group = null;
  for (const [id, row] of entries) {
    const ordinal = Number(/\.(\d+)$/u.exec(id)?.[1]);
    if (page !== row.capture || previous + 1 !== ordinal || !readable(row) || /^\s*<[^>]+>\s*$/u.test(row.text)) {
      section = ""; group = null;
    }
    page = row.capture;
    previous = ordinal;
    if (!readable(row)) continue;
    for (const {mark, body} of units(row.text)) {
      if (/^[□■▣]$/u.test(mark)) {
        section = body; group = null;
        continue;
      }
      if (/(?:예시|참고|가정|보류|반대|기각)\s*(?:사례|자료|의견|기준|조건|목록|사항)?/u.test(section)) continue;
      const colon = body.search(/[:：]/u);
      const heading = colon < 0 ? "" : body.slice(0, colon).trim();
      const value = colon < 0 ? body : body.slice(colon + 1).trim();
      if (group && (/[ㅇ○●◦•]/u.test(mark) || (!mark && !heading) ||
          (preference.test(heading) && group.role !== "preference") || /^(?:기존|현행|변경|개정)/u.test(heading))) group = null;
      if (colon >= 0 && !value) {
        group = null;
        if (heading.length <= 85 && (eligibility.test(heading) || /지원\s*대상|(?:우대|가산|필수)\s*(?:조건|요건|기준)/u.test(heading))) {
          group = { heading, id, role: preference.test(heading) ? "preference" :
            /(?:기존|현행|변경\s*전|개정\s*전)/u.test(heading) ? "current" : "proposed", items: [] };
          groups.push(group);
        }
        continue;
      }
      if (group && mark && value && body.length <= 120 &&
          (concrete.test(value) || /요건|요구|능력|가능|대상|결격|필수/u.test(body))) {
        group.items.push({ id, text: body });
        continue;
      }
      if (group) group = null;
      const amount = quota.exec(value);
      if (amount && !/예시|참고|가정|반대|보류|제외/u.test(body) && !/(?:예시|참고|실적|성과|기대\s*효과)/u.test(section))
        quotas.push({id, text: amount[1], value: amount[2], source: body, page,
          rank: Number(period.test(amount[1])) * 2 + Number(/모집|선발/u.test(amount[1]))});
      if (!value || value.length > 115 || /명단|목록|예시|참고/u.test(heading)) continue;
      const labeled = heading && heading.length <= 35;
      if (labeled && (preference.test(value) || preference.test(heading) || preference.test(section)) &&
          concrete.test(value) && !/명칭|이름|용어|명단/u.test(heading) && /(?:가산점|우대|가점|선발|부여|배점)/u.test(heading + value)) {
        facts.push(detail("preference", (preference.test(value) ? "" : heading + " · ") + value, [id]));
      } else if (labeled && /(?:요건|기준|자격|조건|제한).{0,8}(?:폐지|삭제|완화)/u.test(heading) &&
          /폐지|삭제|완화|제거/u.test(value) && !preference.test(section)) {
        facts.push(detail("proposed", heading + " · " + value, [id]));
      } else if (/^(?:\(?기존\)?|\(?현행\)?|개정\s*전|변경\s*전)/u.test(heading) &&
          eligibility.test(section + heading) && concrete.test(value) && !preference.test(section)) {
        facts.push(detail("current", heading + " · " + value, [id]));
      } else if (/^(?:\(?변경\)?|\(?개정\)?|신설)/u.test(heading) && eligibility.test(section + heading) &&
          concrete.test(value) && !preference.test(section)) {
        facts.push(detail("proposed", heading + " · " + value, [id]));
      }
    }
  }
  for (const g of groups) {
    let batch = [];
    const flush = () => {
      if (batch.length) facts.push(detail(g.role, g.heading + " · " + batch.map(x => x.text).join(" / "), [g.id, ...batch.map(x => x.id)]));
      batch = [];
    };
    for (const item of g.items) {
      if (g.heading.length + batch.reduce((n, x) => n + x.text.length + 3, 0) + item.text.length > 135 ||
          new Set([g.id, ...batch.map(x => x.id), item.id]).size > 4) flush();
      batch.push(item);
    }
    flush();
  }
  return { facts, quotas };
}

export function preserveEligibility(points, evidence) {
  if (!points?.length || !evidence || points.some(p => p.mode?.startsWith("표의 "))) return points;
  const entries = Object.entries(evidence);
  if (entries.length > 80 || new Set(entries.map(([,r]) => r.capture)).size > 5) return points;
  const body = entries.filter(([,r]) => readable(r)).map(([,r]) => r.text).join(" ");
  if (!eligibility.test(body) || !change.test(body) || !/모집|선발|신청|지원\s*대상/u.test(body)) return points;
  const { facts, quotas } = candidates(entries);
  const chosen = quotas.sort((a,b) => b.rank-a.rank)[0];
  // One stand-alone count is safe only if all candidates name the same
  // amount, on one page, with an explicit endpoint rather than an increment.
  const stable = chosen && quotas.every(q => q.page === chosen.page && compact(q.value) === compact(chosen.value));
  if (stable) facts.push(detail("quota", chosen.text, [chosen.id]));
  if (!facts.length) return points;
  const output = points.map(p => {
    if (!stable || p.mode !== "요약") return p;
    const cited = quotas.filter(q => p.refs.includes(q.id));
    if (!cited.length) return p;
    const text = quotaChange(p.text, chosen.value, cited.map(q=>q.source).join(" "));
    return text === p.text ? p : { ...p, text };
  });
  // Keep the first model summary as context. Insert compact details beside
  // the point that actually cites the applicable list or heading.
  const insertions = new Map();
  const selected = new Set();
  for (const role of ["current", "proposed", "preference", "quota"]) {
    const first = facts.find(f => f.eligibilityRole === role);
    if (first) selected.add(first);
  }
  for (const fact of facts) if (selected.size < 6) selected.add(fact);
  for (const fact of facts.filter(f => selected.has(f))) {
    if (output.some(p => compact(p.text).includes(compact(fact.text)) &&
        fact.refs.every(id=>p.refs.includes(id)) && p.mode === mode)) continue;
    let anchor = output.findIndex(p => p.mode !== mode && p.refs.some(id => fact.refs.includes(id)));
    if (anchor < 0) anchor = output.findIndex(p => p.mode !== mode &&
      p.refs.some(id => evidence[id]?.capture === evidence[fact.refs[0]]?.capture));
    if (anchor < 0) continue;
    const bucket = insertions.get(anchor) || [];
    if (!bucket.some(p => p.text === fact.text && p.refs.join() === fact.refs.join())) bucket.push(fact);
    insertions.set(anchor, bucket);
  }
  return insertions.size ? output.flatMap((p, i) => [p, ...(insertions.get(i) || [])]) :
    output.every((p,i) => p === points[i]) ? points : output;
}
