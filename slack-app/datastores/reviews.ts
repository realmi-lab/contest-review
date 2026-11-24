// 받은 평가 의견. 아이디어정리가 Slack CLI(slack datastore query)로 읽어 그 작품의 채점표에 담는다.
import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export default DefineDatastore({
  name: "reviews",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    work_id: { type: Schema.types.string },
    user_id: { type: Schema.types.string }, // 의견을 보낸 사람
    text: { type: Schema.types.string },
    at: { type: Schema.types.string }, // 보낸 시각(ISO)
  },
});
