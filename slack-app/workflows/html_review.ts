// HTML 의견 받기 워크플로: 내보내기 HTML의 [의견 보내기]가 부르는 웹훅(triggers/html_review_webhook.ts)으로 시작한다.
import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { SaveHtmlReview } from "../functions/save_html_review.ts";

const HtmlReviewWorkflow = DefineWorkflow({
  callback_id: "html_review",
  title: "HTML 의견 받기",
  input_parameters: {
    properties: {
      work_id: { type: Schema.types.string },
      user_id: { type: Schema.types.string }, // HTML을 받은 담당자
      title: { type: Schema.types.string },
      text: { type: Schema.types.string },
    },
    required: ["work_id", "user_id", "title", "text"],
  },
});

HtmlReviewWorkflow.addStep(SaveHtmlReview, {
  work_id: HtmlReviewWorkflow.inputs.work_id,
  user_id: HtmlReviewWorkflow.inputs.user_id,
  title: HtmlReviewWorkflow.inputs.title,
  text: HtmlReviewWorkflow.inputs.text,
});

export default HtmlReviewWorkflow;
