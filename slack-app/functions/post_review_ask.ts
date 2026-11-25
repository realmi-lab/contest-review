// 담당자 DM에 HTML 파일과 [평가 답장하기] 단추를 보낸다 → 입력 창 → 의견을 reviews 저장소에 담는다.
// Slack 서버에서 돌아가므로 아이디어정리가 꺼져 있어도 되고, 아이디어정리는 켜질 때·1분마다 저장소를 읽어 채점표에 담는다.
// 보낸 뒤에는 단추가 [답변 수정하기]로 바뀌어, 같은 의견(저장소 항목 id = 이번 실행 id)을 고쳐 쓸 수 있다.
// 수정할 수 있게 함수는 끝내지 않고 열어 둔다.
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
      ticket: { type: Schema.types.string }, // HTML [의견 보내기]의 일회용 표
    },
    required: ["user_id", "work_id", "title", "filename", "comment", "html", "ticket"],
  },
  output_parameters: { properties: {}, required: [] },
});

const BUTTON = "review_reply", EDIT = "review_edit", FORM = "review_form";
// 제목은 넣지 않는다(파일과 함께 가는 글에 있다). Slack 굵게(*…*)는 바로 뒤에 조사가 붙으면 별표가 그대로 보여 안내 글에는 쓰지 않는다.
const ASK = "💬 *평가 의견을 보내 주세요*\n하단의 HTML 파일을 열어 보고 평가 답장하기 단추를 눌러 의견을 적어 보내 주시면 감사하겠습니다.";
const button = (action_id: string, text: string) => ({ type: "actions", elements: [{ type: "button", action_id, style: "primary", text: { type: "plain_text", text } }] });

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
  // HTML의 [의견 보내기]가 들고 올 일회용 표에 누구에게 어느 작품을 보냈는지 남긴다(save_html_review.ts가 꺼낸다)
  const kept = await client.apps.datastore.put({
    datastore: "tickets",
    item: { id: inputs.ticket, work_id: inputs.work_id, user_id: inputs.user_id, title: inputs.title, at: new Date().toISOString() },
  });
  if (!kept.ok) return { error: `일회용 표를 남기지 못했습니다: ${kept.error}` };
  const posted = await client.chat.postMessage({
    channel: dm.channel.id,
    text: "평가 의견을 보내 주세요",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: ASK } }, button(BUTTON, "평가 답장하기")],
  });
  if (!posted.ok) return { error: `단추 메시지를 보내지 못했습니다: ${posted.error}` };
  const failed = await uploadHtml(client, dm.channel.id, inputs.filename, inputs.html, inputs.comment); // 단추 메시지 아래에 붙는다
  if (failed) return { error: `HTML 파일을 보내지 못했습니다: ${failed}` };
  return { completed: false }; // 단추가 눌릴 때까지 기다린다
}).addBlockActionsHandler([BUTTON, EDIT], async ({ body, client }) => {
  // 수정이면 보냈던 의견을 입력 창에 미리 채운다
  const before = body.actions[0].action_id === EDIT
    ? (await client.apps.datastore.get({ datastore: "reviews", id: body.function_data.execution_id })).item?.text ?? ""
    : "";
  await client.views.open({
    interactivity_pointer: body.interactivity.interactivity_pointer,
    view: {
      type: "modal",
      callback_id: FORM,
      private_metadata: JSON.stringify({ channel: body.container.channel_id, ts: body.container.message_ts }),
      title: { type: "plain_text", text: before ? "답변 수정하기" : "평가 답장하기" },
      submit: { type: "plain_text", text: "보내기" },
      close: { type: "plain_text", text: "닫기" },
      blocks: [{
        type: "input",
        block_id: "opinion",
        label: { type: "plain_text", text: "평가 의견" },
        element: { type: "plain_text_input", action_id: "text", multiline: true, ...(before && { initial_value: before }),
          placeholder: { type: "plain_text", text: "이 작품에 대한 의견을 자유롭게 적어 주세요" } },
      }],
    },
  });
}).addViewSubmissionHandler([FORM], async ({ view, body, client }) => {
  const { inputs, execution_id } = body.function_data;
  const { channel, ts } = JSON.parse(view.private_metadata ?? "{}");
  const text = String(view.state.values.opinion.text.value ?? "").trim();
  if (!text) return { response_action: "errors", errors: { opinion: "의견을 적어 주세요" } };
  const saved = await client.apps.datastore.put({
    datastore: "reviews",
    item: { id: execution_id, work_id: inputs.work_id, user_id: body.user.id, text, at: new Date().toISOString() },
  });
  if (!saved.ok) return { response_action: "errors", errors: { opinion: `의견을 남기지 못했습니다(${saved.error}). 잠시 뒤 다시 보내 주세요.` } };
  const quote = text.split("\n").map((line) => "> " + line).join("\n");
  await client.chat.update({
    channel,
    ts,
    text: "의견을 보냈습니다",
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${ASK}\n✅ 의견을 보냈습니다. 감사합니다.\n${quote}` } },
      button(EDIT, "답변 수정하기"),
    ],
  });
});
