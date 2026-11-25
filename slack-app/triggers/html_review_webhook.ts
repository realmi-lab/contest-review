// 내보내기 HTML의 [의견 보내기]가 부르는 웹훅. POST {"work_id", "user_id", "title", "text"}
// 만들기: slack trigger create --trigger-def triggers/html_review_webhook.ts → 나온 주소를 deploy/site.json의 slack.htmlWebhook에 넣는다.
import type { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerTypes } from "deno-slack-api/mod.ts";
import HtmlReviewWorkflow from "../workflows/html_review.ts";

const trigger: Trigger<typeof HtmlReviewWorkflow.definition> = {
  type: TriggerTypes.Webhook,
  name: "아이디어정리 HTML 의견",
  workflow: `#/workflows/${HtmlReviewWorkflow.definition.callback_id}`,
  inputs: {
    work_id: { value: "{{data.work_id}}" },
    user_id: { value: "{{data.user_id}}" },
    title: { value: "{{data.title}}" },
    text: { value: "{{data.text}}" },
  },
};

export default trigger;
