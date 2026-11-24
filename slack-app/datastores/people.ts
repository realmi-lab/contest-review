// Slack 사람 목록(아이디어정리의 담당자 검색용). 사람 목록 맞추기(functions/sync_people.ts)가 매일 채운다.
// users.list 한 쪽(최대 200명)을 한 항목에 JSON으로 담는다(id "0", "1", …). 항목 수가 적어 빨리 쓰고 읽는다.
import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export default DefineDatastore({
  name: "people",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    list: { type: Schema.types.string }, // [{ id, name, nick, title }, …]
  },
});
