// 아이디어정리 서버가 부르는 웹훅. POST {"channel_id": "...", "work_id": "...", "title": "..."}
// 만들기: slack trigger create --trigger-def triggers/review_webhook.ts → 나온 주소를 deploy/site.json의 slack.reviewWebhook에 넣는다.
import type { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerTypes } from "deno-slack-api/mod.ts";
import AskReviewWorkflow from "../workflows/ask_review.ts";

const trigger: Trigger<typeof AskReviewWorkflow.definition> = {
  type: TriggerTypes.Webhook,
  name: "아이디어정리 평가 요청",
  workflow: `#/workflows/${AskReviewWorkflow.definition.callback_id}`,
  inputs: {
    channel_id: { value: "{{data.channel_id}}" },
    work_id: { value: "{{data.work_id}}" },
    title: { value: "{{data.title}}" },
  },
};

export default trigger;
