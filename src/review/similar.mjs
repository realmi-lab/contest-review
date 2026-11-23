// 비슷한 제안 찾기. 제목(묶음 머리말과 [표시] 빼고 두 번 반영)·한 줄 요약·핵심 요약을 글자 두 개 묶음(bigram)
// TF-IDF 코사인으로 비교한다. AI를 쓰지 않아 비용이 없고 같은 자료면 늘 같은 결과다. 중복인지는 사람이 판정한다.
// (실측: 지난 공모 30건 사이에는 같은 제안이 없어 가장 높은 값이 0.18이었다. '대출 연체 예측'과 '대출 신청 예측' 같은 관련 주제가 0.1~0.2)

const coreTitle = (name) => String(name).split(" · ").pop().replace(/\[[^\]]*\]/g, " ");

// 비교할 글: 제목 두 번 + 요약 문장(한계는 빼고, 제출물 내용만)
export function documentOf(w) {
  const brief = (w.cloudReading?.edition?.brief ?? []).filter((p) => p.topic !== "한계·확인할 점").map((p) => p.text);
  const title = coreTitle(w.name);
  return [title, title, ...brief].join(" ");
}

const words = (text) =>
  text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((word) => word.length >= 2);

function bigrams(text) {
  const counts = new Map();
  for (const word of words(text))
    for (let i = 0; i < word.length - 1; i++) {
      const gram = word.slice(i, i + 2);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  return counts;
}

// 화면에 보일 때 조사만 다른 낱말(예: catboost로·catboost의)은 하나로 본다
const stem = (word) => (word.length > 2 ? word.replace(/(으로|에서|은|는|을|를|의|에|로|와)$/u, "") : word);

// 두 글에 함께 나오는 낱말 중 점수에 크게 기여한 것 (화면에 '겹치는 말'로 보여 준다)
function sharedWords(text, weights, other) {
  const score = new Map();
  for (const word of new Set(words(text))) {
    let sum = 0;
    for (let i = 0; i < word.length - 1; i++) {
      const gram = word.slice(i, i + 2);
      if (other.has(gram)) sum += weights.get(gram) ?? 0;
    }
    const key = stem(word);
    if (sum > 0) score.set(key, Math.max(score.get(key) ?? 0, sum / (word.length - 1)));
  }
  return [...score].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([word]) => word);
}

// works 중 id 작품과 비슷한 것: [{ id, name, score(0~1), words }] 높은 순, floor 이상 limit개까지
export function similarWorks(works, id, limit = 3, floor = 0.1) {
  const docs = works.map((w) => ({ w, text: documentOf(w), grams: bigrams(documentOf(w)) }));
  const df = new Map();
  for (const d of docs) for (const gram of d.grams.keys()) df.set(gram, (df.get(gram) ?? 0) + 1);
  const n = docs.length;
  for (const d of docs) {
    d.weights = new Map();
    let norm = 0;
    for (const [gram, count] of d.grams) {
      const weight = (1 + Math.log(count)) * Math.log((n + 1) / (df.get(gram) + 1));
      if (weight > 0) {
        d.weights.set(gram, weight);
        norm += weight * weight;
      }
    }
    d.norm = Math.sqrt(norm) || 1;
  }
  const self = docs.find((d) => d.w.id === id);
  if (!self) return [];
  return docs
    .filter((d) => d !== self)
    .map((d) => {
      let dot = 0;
      for (const [gram, weight] of self.weights) dot += weight * (d.weights.get(gram) ?? 0);
      return { d, score: dot / (self.norm * d.norm) };
    })
    .filter((x) => x.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d, score }) => ({ id: d.w.id, name: d.w.name, score: Math.round(score * 100) / 100, words: sharedWords(self.text, self.weights, d.weights) }));
}
