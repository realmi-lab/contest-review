// HTML 의견 받기 워크플로: 내보내기 HTML의 [의견 보내기]가 부르는 웹훅(triggers/html_review_webhook.ts)으로 시작한다.
import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { SaveHtmlReview } from "../functions/save_html_review.ts";

const HtmlReviewWorkflow = DefineWorkflow({
  callback_id: "html_review",
  title: "HTML 의견 받기",
  input_parameters: {
    properties: {
      ticket: { type: Schema.types.string }, // 보낸 건의 일회용 표(받는 사람·작품은 표 기록에서 꺼낸다)
      text: { type: Schema.types.string },
    },
    required: ["ticket", "text"],
  },
});

HtmlReviewWorkflow.addStep(SaveHtmlReview, {
  ticket: HtmlReviewWorkflow.inputs.ticket,
  text: HtmlReviewWorkflow.inputs.text,
});

export default HtmlReviewWorkflow;
