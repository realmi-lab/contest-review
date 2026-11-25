// 평가 요청 워크플로: 웹훅(triggers/review_webhook.ts)으로 받은 담당자에게 HTML 파일과 [평가 답장하기] 단추 DM을 보낸다.
import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { PostReviewAsk } from "../functions/post_review_ask.ts";

const AskReviewWorkflow = DefineWorkflow({
  callback_id: "ask_review",
  title: "평가 요청",
  input_parameters: {
    properties: {
      user_id: { type: Schema.types.string }, // 담당자
      work_id: { type: Schema.types.string },
      title: { type: Schema.types.string },
      filename: { type: Schema.types.string },
      comment: { type: Schema.types.string }, // 파일과 함께 보낼 안내 글
      html: { type: Schema.types.string },
      ticket: { type: Schema.types.string }, // HTML [의견 보내기]의 일회용 표
    },
    required: ["user_id", "work_id", "title", "filename", "comment", "html", "ticket"],
  },
});

AskReviewWorkflow.addStep(PostReviewAsk, {
  user_id: AskReviewWorkflow.inputs.user_id,
  work_id: AskReviewWorkflow.inputs.work_id,
  title: AskReviewWorkflow.inputs.title,
  filename: AskReviewWorkflow.inputs.filename,
  comment: AskReviewWorkflow.inputs.comment,
  html: AskReviewWorkflow.inputs.html,
  ticket: AskReviewWorkflow.inputs.ticket,
});

export default AskReviewWorkflow;
