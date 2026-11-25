// [평가 답장하기] 링크(보낸 건마다 만든 워크플로 링크)를 누르면 의견 입력 창을 연다. 보내면 reviews 저장소에 담고 DM으로 알린다.
// 링크를 누른 사람(Slack이 알려 준다)의 의견으로 기록하고, 작품은 링크에 담긴 일회용 표의 기록(tickets)에서 꺼낸다.
// 다시 누르면 보냈던 의견이 채워진 채 열려 고칠 수 있다(id = reply:작품:사람, HTML 칸으로 보낸 의견과 같은 자리라 마지막 것이 남는다).
// 단추가 열려 있는 작업에 기대지 않아(누를 때마다 새로 시작) 시간이 지나도, 휴대폰에서도 동작한다.
import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";

export const OpenReplyForm = DefineFunction({
  callback_id: "open_reply_form",
  title: "평가 의견 입력 창",
  source_file: "functions/open_reply_form.ts",
  input_parameters: {
    properties: {
      ticket: { type: Schema.types.string },
      interactivity: { type: Schema.slack.types.interactivity },
    },
    required: ["ticket", "interactivity"],
  },
  output_parameters: { properties: {}, required: [] },
});

const FORM = "reply_form";
export const replyId = (work: string, user: string) => `reply:${work}:${user}`;

export default SlackFunction(OpenReplyForm, async ({ inputs, client }) => {
  const found = await client.apps.datastore.get({ datastore: "tickets", id: inputs.ticket });
  const sent = found.ok ? found.item : null;
  if (!sent?.work_id) return { error: "이 링크의 기록을 찾지 못했습니다" };
  const user = inputs.interactivity.interactor.id;
  const before = (await client.apps.datastore.get({ datastore: "reviews", id: replyId(sent.work_id, user) })).item?.text ?? "";
  const opened = await client.views.open({
    interactivity_pointer: inputs.interactivity.interactivity_pointer,
    view: {
      type: "modal",
      callback_id: FORM,
      notify_on_close: true,
      private_metadata: JSON.stringify({ work: sent.work_id, title: sent.title }),
      title: { type: "plain_text", text: before ? "답변 수정하기" : "평가 답장하기" },
      submit: { type: "plain_text", text: "보내기" },
      close: { type: "plain_text", text: "닫기" },
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*[${sent.title}]*\n지금 제출하신 내용으로 평가됩니다.` } },
        {
          type: "input",
          block_id: "opinion",
          label: { type: "plain_text", text: "평가 의견" },
          element: { type: "plain_text_input", action_id: "text", multiline: true, ...(before && { initial_value: before }),
            placeholder: { type: "plain_text", text: "이 작품에 대한 의견을 자유롭게 적어 주세요" } },
        },
      ],
    },
  });
  if (!opened.ok) return { error: `입력 창을 열지 못했습니다: ${opened.error}` };
  return { completed: false }; // 입력 창을 보내거나 닫을 때 마친다
}).addViewSubmissionHandler([FORM], async ({ view, body, client }) => {
  const { work, title } = JSON.parse(view.private_metadata ?? "{}");
  const text = String(view.state.values.opinion.text.value ?? "").trim().slice(0, 4000);
  if (!text) return { response_action: "errors", errors: { opinion: "의견을 적어 주세요" } };
  const user = body.user.id;
  const saved = await client.apps.datastore.put({ datastore: "reviews", item: { id: replyId(work, user), work_id: work, user_id: user, text, at: new Date().toISOString() } });
  if (!saved.ok) return { response_action: "errors", errors: { opinion: `의견을 남기지 못했습니다(${saved.error}). 잠시 뒤 다시 보내 주세요.` } };
  const dm = await client.conversations.open({ users: user });
  if (dm.ok) {
    const quote = text.split("\n").map((line) => "> " + line).join("\n");
    await client.chat.postMessage({ channel: dm.channel.id, text: "의견을 받았습니다",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `✅ *[${title}]* 의견을 받았습니다. 감사합니다.\n${quote}` } }] });
  }
  await client.functions.completeSuccess({ function_execution_id: body.function_data.execution_id, outputs: {} });
}).addViewClosedHandler([FORM], async ({ body, client }) => {
  await client.functions.completeSuccess({ function_execution_id: body.function_data.execution_id, outputs: {} });
});
