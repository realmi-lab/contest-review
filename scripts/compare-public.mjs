// Separate, explicit opt-in comparison. Only the built-in synthetic proposal is accepted.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  defaults,
  gradingPrompt,
  instructions,
  scopeGuide,
  reportSchema,
  total,
  validateReport,
} from "../src/review/review.mjs";
import { sampleImage } from "../src/sample.mjs";
import { evaluate } from "../src/ai/model.mjs";
if (process.argv.length !== 2)
  throw Error("이 명령은 내장 공유 우산 합성 예제만 비교합니다.");
if (!process.env.OPENAI_API_KEY)
  throw Error("공개 예제 비교를 위해 OPENAI_API_KEY가 필요합니다.");
const root = fileURLToPath(new URL("../", import.meta.url));
const bytes = await sampleImage("umbrella");
const run = spawnSync(process.execPath, [path.join(root, "src", "ocr", "ocr.mjs")], {
  input: bytes,
  maxBuffer: 2e6,
});
if (run.status !== 0) throw Error("합성 예제 OCR 실패");
const { lines } = JSON.parse(run.stdout);
const name = "비 오는 날 공유 우산 · 합성 예제",
  spec = defaults;
const local = await evaluate(
  { name, rubric: spec, complete: true },
  [
    {
      id: "example",
      label: "합성 제안서 1쪽",
      document: "합성 제안서",
      page: 1,
      total: 1,
      status: "ready",
      lines,
    },
  ],
  () => bytes,
  console.error,
);
const ids = Object.keys(local.evidence);
const prompt =
  gradingPrompt(spec) +
  "\n분야를 독립적으로 분류하고 그 분야의 기준을 적용하라. " +
  JSON.stringify(
    spec.categories.map((category) => ({
      category,
      guide: scopeGuide(category),
    })),
  ) +
  "\n작품명 " +
  name +
  "\n자료 " +
  JSON.stringify(ids.map((id) => ({ id, text: local.evidence[id].text })));
const schema = reportSchema(spec, ids);
// Responses structured output supports the strict JSON Schema subset.
function strict(node) {
  if (Array.isArray(node)) return node.map(strict);
  if (node && typeof node === "object")
    return Object.fromEntries(
      Object.entries(node)
        .filter(
          ([k]) =>
            ![
              "minLength",
              "minItems",
              "maxItems",
              "minimum",
              "maximum",
            ].includes(k),
        )
        .map(([k, v]) => [k, strict(v)]),
    );
  return node;
}
const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + process.env.OPENAI_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-6.2-sol",
    reasoning: { effort: "medium" },
    store: false,
    instructions,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "contest_review",
        strict: true,
        schema: strict(schema),
      },
    },
  }),
  signal: AbortSignal.timeout(300000),
});
if (!response.ok) throw Error("OpenAI API 응답 " + response.status);
const remote = await response.json();
const text = remote.output
  .flatMap((x) => x.content || [])
  .filter((x) => x.type === "output_text")
  .map((x) => x.text)
  .join("");
const report = validateReport(JSON.parse(text), spec, ids);
console.log(
  JSON.stringify(
    {
      fixture: name,
      local: { model: local.model, total: local.total, report: local.report },
      publicComparison: {
        model: remote.model,
        total: total(report, spec),
        report,
      },
    },
    null,
    2,
  ),
);
