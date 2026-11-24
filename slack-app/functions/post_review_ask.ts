// [평가 답장하기] 단추 DM → 입력 창 → 의견을 idea_proposal 봇의 DM(HTML 파일이 간 곳)에 남긴다.
// Slack 서버에서 돌아가므로 아이디어정리가 꺼져 있어도 된다. idea_proposal 설정은 바꾸지 않는다:
// 의견은 그 봇의 토큰(환경 변수 PROPOSAL_BOT_TOKEN, slack env add로 넣는다)으로 그 봇의 DM에 쓰고, 아이디어정리는 그 DM을 읽어 담는다.
// 의견 메시지의 첫 블록 block_id에 "review|작품 id|보낸 사람"을 숨겨 둔다. 의견은 한 번 보내면 단추를 '의견을 보냈습니다'로 바꾸고 마친다.
import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { SlackAPI } from "deno-slack-api/mod.ts";

export const PostReviewAsk = DefineFunction({
  callback_id: "post_review_ask",
  title: "평가 단추 보내기",
  source_file: "functions/post_review_ask.ts",
  input_parameters: {
    properties: {
      user_id: { type: Schema.types.string },
      work_id: { type: Schema.types.string },
      title: { type: Schema.types.string },
      reply_channel: { type: Schema.types.string },
    },
    required: ["user_id", "work_id", "title", "reply_channel"],
  },
  output_parameters: { properties: {}, required: [] },
});

const BUTTON = "review_reply", FORM = "review_form";
const askText = (title: string) => `💬 *[${title}] 평가 의견을 보내 주세요*\n작품 HTML은 idea_proposal 봇이 보낸 DM에 있습니다. 아래 *평가 답장하기*를 눌러 의견을 적어 보내면 아이디어정리 채점표에 담깁니다.`;

export default SlackFunction(PostReviewAsk, async ({ inputs, client }) => {
  const posted = await client.chat.postMessage({
    channel: inputs.user_id, // 이 앱과 담당자의 DM
    text: `[${inputs.title}] 평가 의견을 보내 주세요`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: askText(inputs.title) } },
      { type: "actions", elements: [{ type: "button", action_id: BUTTON, style: "primary", text: { type: "plain_text", text: "평가 답장하기" } }] },
    ],
  });
  if (!posted.ok) return { error: `단추 메시지를 보내지 못했습니다: ${posted.error}` };
  return { completed: false }; // 단추가 눌릴 때까지 기다린다
}).addBlockActionsHandler([BUTTON], async ({ body, client }) => {
  await client.views.open({
    interactivity_pointer: body.interactivity.interactivity_pointer,
    view: {
      type: "modal",
      callback_id: FORM,
      private_metadata: JSON.stringify({ channel: body.container.channel_id, ts: body.container.message_ts }),
      title: { type: "plain_text", text: "평가 답장하기" },
      submit: { type: "plain_text", text: "보내기" },
      close: { type: "plain_text", text: "닫기" },
      blocks: [{
        type: "input",
        block_id: "opinion",
        label: { type: "plain_text", text: "평가 의견" },
        element: { type: "plain_text_input", action_id: "text", multiline: true, placeholder: { type: "plain_text", text: "이 작품에 대한 의견을 자유롭게 적어 주세요" } },
      }],
    },
  });
}).addViewSubmissionHandler([FORM], async ({ view, body, client, env }) => {
  const { inputs } = body.function_data;
  const { channel, ts } = JSON.parse(view.private_metadata ?? "{}");
  const text = String(view.state.values.opinion.text.value ?? "").trim();
  if (!text) return { response_action: "errors", errors: { opinion: "의견을 적어 주세요" } };
  const saved = await SlackAPI(env.PROPOSAL_BOT_TOKEN).chat.postMessage({
    channel: inputs.reply_channel,
    text: `✅ [${inputs.title}] 의견이 채점표에 담깁니다`,
    blocks: [
      { type: "section", block_id: `review|${inputs.work_id}|${body.user.id}`, text: { type: "mrkdwn", text: `✅ <@${body.user.id}> 님의 *[${inputs.title}]* 의견이 아이디어정리 채점표에 담깁니다` } },
      { type: "section", text: { type: "plain_text", text } },
    ],
  });
  if (!saved.ok) return { response_action: "errors", errors: { opinion: `의견을 남기지 못했습니다(${saved.error}). 잠시 뒤 다시 보내 주세요.` } };
  await client.chat.update({
    channel,
    ts,
    text: `[${inputs.title}] 의견을 보냈습니다`,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: `${askText(inputs.title)}\n✅ 의견을 보냈습니다. 감사합니다.` } }],
  });
  await client.functions.completeSuccess({ function_execution_id: body.function_data.execution_id, outputs: {} });
});
