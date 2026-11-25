// 평가 답장 워크플로: 보낸 건마다 만든 워크플로 링크([평가 답장하기])로 시작해 의견 입력 창을 연다.
import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { OpenReplyForm } from "../functions/open_reply_form.ts";

const ReplyFormWorkflow = DefineWorkflow({
  callback_id: "reply_form",
  title: "평가 답장하기",
  input_parameters: {
    properties: {
      ticket: { type: Schema.types.string }, // 보낸 건의 일회용 표(작품은 표 기록에서 꺼낸다)
      interactivity: { type: Schema.slack.types.interactivity }, // 링크를 누른 사람
    },
    required: ["ticket", "interactivity"],
  },
});

ReplyFormWorkflow.addStep(OpenReplyForm, {
  ticket: ReplyFormWorkflow.inputs.ticket,
  interactivity: ReplyFormWorkflow.inputs.interactivity,
});

export default ReplyFormWorkflow;
