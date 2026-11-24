// 평가 요청 워크플로: 웹훅(triggers/review_webhook.ts)으로 받은 담당자에게 [평가 답장하기] 단추 DM을 보낸다.
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
      reply_channel: { type: Schema.types.string }, // idea_proposal 봇과 담당자의 DM(HTML 파일이 간 곳). 의견을 여기에 남긴다
    },
    required: ["user_id", "work_id", "title", "reply_channel"],
  },
});

AskReviewWorkflow.addStep(PostReviewAsk, {
  user_id: AskReviewWorkflow.inputs.user_id,
  work_id: AskReviewWorkflow.inputs.work_id,
  title: AskReviewWorkflow.inputs.title,
  reply_channel: AskReviewWorkflow.inputs.reply_channel,
});

export default AskReviewWorkflow;
