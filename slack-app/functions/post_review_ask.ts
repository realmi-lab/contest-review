// 담당자 DM에 HTML 파일과 [평가 답장하기] 단추를 보낸다 → 입력 창 → 의견을 reviews 저장소에 담는다.
// Slack 서버에서 돌아가므로 아이디어정리가 꺼져 있어도 되고, 아이디어정리는 켜질 때·1분마다 저장소를 읽어 채점표에 담는다.
// 의견은 한 번 보내면 단추를 '의견을 보냈습니다'로 바꾸고 마친다.
import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";

export const PostReviewAsk = DefineFunction({
  callback_id: "post_review_ask",
  title: "평가 단추 보내기",
  source_file: "functions/post_review_ask.ts",
  input_parameters: {
    properties: {
      user_id: { type: Schema.types.string },
      work_id: { type: Schema.types.string },
      title: { type: Schema.types.string },
      filename: { type: Schema.types.string },
      comment: { type: Schema.types.string },
      html: { type: Schema.types.string },
    },
    required: ["user_id", "work_id", "title", "filename", "comment", "html"],
  },
  output_parameters: { properties: {}, required: [] },
});

const BUTTON = "review_reply", FORM = "review_form";
const askText = (title: string) => `💬 *[${title}] 평가 의견을 보내 주세요*\n위 HTML 파일을 열어 보고 아래 *평가 답장하기*를 눌러 의견을 적어 보내면 아이디어정리 채점표에 담깁니다.`;

// 파일 올리기 3단계: 올릴 주소 받기 → 올리기 → 채널에 안내 글과 함께 붙이기
async function uploadHtml(client: any, channel: string, filename: string, html: string, comment: string) {
  const bytes = new TextEncoder().encode(html);
  const slot = await client.apiCall("files.getUploadURLExternal", { filename, length: bytes.length });
  if (!slot.ok) return slot.error;
  const up = await fetch(slot.upload_url, { method: "POST", body: bytes });
  if (!up.ok) return "HTTP " + up.status;
  const done = await client.apiCall("files.completeUploadExternal", {
    files: JSON.stringify([{ id: slot.file_id, title: filename }]),
    channel_id: channel,
    initial_comment: comment,
  });
  return done.ok ? "" : done.error;
}

export default SlackFunction(PostReviewAsk, async ({ inputs, client }) => {
  const dm = await client.conversations.open({ users: inputs.user_id }); // 이 앱과 담당자의 DM
  if (!dm.ok) return { error: `DM을 열지 못했습니다: ${dm.error}` };
  const failed = await uploadHtml(client, dm.channel.id, inputs.filename, inputs.html, inputs.comment);
  if (failed) return { error: `HTML 파일을 보내지 못했습니다: ${failed}` };
  const posted = await client.chat.postMessage({
    channel: dm.channel.id,
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
}).addViewSubmissionHandler([FORM], async ({ view, body, client }) => {
  const { inputs } = body.function_data;
  const { channel, ts } = JSON.parse(view.private_metadata ?? "{}");
  const text = String(view.state.values.opinion.text.value ?? "").trim();
  if (!text) return { response_action: "errors", errors: { opinion: "의견을 적어 주세요" } };
  const saved = await client.apps.datastore.put({
    datastore: "reviews",
    item: { id: crypto.randomUUID(), work_id: inputs.work_id, user_id: body.user.id, text, at: new Date().toISOString() },
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
