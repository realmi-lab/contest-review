// 평가 요청 워크플로: 웹훅(triggers/review_webhook.ts)으로 받은 그룹 DM·작품에 단추 메시지를 올린다.
import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { PostReviewAsk } from "../functions/post_review_ask.ts";

const AskReviewWorkflow = DefineWorkflow({
  callback_id: "ask_review",
  title: "평가 요청",
  input_parameters: {
    properties: {
      channel_id: { type: Schema.types.string }, // 아이디어정리 봇이 연 그룹 DM
      work_id: { type: Schema.types.string },
      title: { type: Schema.types.string },
    },
    required: ["channel_id", "work_id", "title"],
  },
});

AskReviewWorkflow.addStep(PostReviewAsk, {
  channel_id: AskReviewWorkflow.inputs.channel_id,
  work_id: AskReviewWorkflow.inputs.work_id,
  title: AskReviewWorkflow.inputs.title,
});

export default AskReviewWorkflow;
