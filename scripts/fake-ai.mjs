// 화면 점검용: 서버를 띄울 때 미리 불러와(node --import) Anthropic 요청을 가짜 응답으로 바꾼다.
// 응답은 요청에 담긴 JSON 규격을 채운 값이다. 비용이 들지 않고 실제 키도 필요 없다.
const realFetch = globalThis.fetch;
let count = 0;

// 규격(JSON Schema)을 채운 값: 배열은 한 개, 정수 허용값은 0(없음)이 아닌 첫 값, 글은 번호 붙은 문장
function fill(schema) {
  if (schema.enum) return schema.enum.find((x) => x !== 0) ?? schema.enum[0];
  if (schema.type === "object") return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, fill(v)]));
  if (schema.type === "array") return [fill(schema.items)];
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return true;
  return "우산을 빌려 쓰는 방안 " + ++count + "번 문장이다.";
}

globalThis.fetch = async (url, init) => {
  if (!String(url).includes("anthropic.com")) return realFetch(url, init);
  const body = JSON.parse(init.body);
  const schema = JSON.parse(body.system.split("\n").at(-1)); // claude-summary.mjs가 시스템 프롬프트 끝에 붙인 규격
  return new Response(JSON.stringify({
    model: body.model, stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 300 },
    content: [{ type: "text", text: JSON.stringify(fill(schema)) }],
  }), { status: 200 });
};
