// 내보내기 HTML 파일 안의 [의견 보내기]로 온 의견을 reviews 저장소에 담고, 보낸 사람의 DM에 받았다고 알린다.
// 같은 사람이 같은 작품에 다시 보내면 앞의 의견을 바꾼다(id = html:작품:사람). 아이디어정리가 저장소를 읽어 채점표에 담는다.
// HTML에는 받는 사람이 정해져 들어가므로(보낼 때 고른 담당자), 파일이 다른 사람에게 전달되면 그 사람도 이 이름으로 보낼 수 있다.
import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";

export const SaveHtmlReview = DefineFunction({
  callback_id: "save_html_review",
  title: "HTML 의견 받기",
  source_file: "functions/save_html_review.ts",
  input_parameters: {
    properties: {
      work_id: { type: Schema.types.string },
      user_id: { type: Schema.types.string },
      title: { type: Schema.types.string },
      text: { type: Schema.types.string },
    },
    required: ["work_id", "user_id", "title", "text"],
  },
  output_parameters: { properties: {}, required: [] },
});

export default SlackFunction(SaveHtmlReview, async ({ inputs, client }) => {
  const text = inputs.text.trim().slice(0, 4000);
  if (!text || !inputs.work_id || !/^[UW][A-Z0-9]+$/.test(inputs.user_id)) return { error: "의견·작품·보낸 사람이 비어 있습니다" };
  const saved = await client.apps.datastore.put({
    datastore: "reviews",
    item: { id: `html:${inputs.work_id}:${inputs.user_id}`, work_id: inputs.work_id, user_id: inputs.user_id, text, at: new Date().toISOString() },
  });
  if (!saved.ok) return { error: `의견을 남기지 못했습니다: ${saved.error}` };
  const dm = await client.conversations.open({ users: inputs.user_id });
  if (dm.ok) {
    const quote = text.split("\n").map((line) => "> " + line).join("\n");
    await client.chat.postMessage({
      channel: dm.channel.id,
      text: "HTML에서 보낸 의견을 받았습니다",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `✅ *[${inputs.title}]* HTML에서 보낸 의견을 받았습니다\n${quote}` } }],
    });
  }
  return { outputs: {} };
});
