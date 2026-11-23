import test from "node:test";
import assert from "node:assert/strict";
import { aiSettings } from "../claude-summary.mjs";

test("AI 연결은 주소를 비우면 Anthropic, LiteLLM 주소를 넣으면 LiteLLM이고 모델은 기본 Haiku 5.5다", () => {
  assert.deepEqual(aiSettings(), { provider: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", custom: "", model: "claude-haiku-5-5", label: "Haiku 5.5", plainJson: false });
  assert.deepEqual(aiSettings({ baseUrl: " https://litellm.company.com/ ", model: "", plainJson: true }),
    { provider: "litellm", name: "LiteLLM", baseUrl: "https://litellm.company.com", custom: "https://litellm.company.com", model: "claude-haiku-5-5", label: "Haiku 5.5", plainJson: true });
  assert.equal(aiSettings({ baseUrl: "https://litellm.company.com", model: "bedrock-haiku" }).label, "bedrock-haiku");
  assert.throws(() => aiSettings({ baseUrl: "litellm.company.com" }), /http:\/\/ 또는 https:\/\//);
});
