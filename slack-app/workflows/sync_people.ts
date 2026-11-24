// 사람 목록 맞추기 워크플로: 매일 한 번(triggers/people_daily.ts) Slack 사람 목록을 people 저장소에 담는다.
import { DefineWorkflow } from "deno-slack-sdk/mod.ts";
import { SyncPeople } from "../functions/sync_people.ts";

const SyncPeopleWorkflow = DefineWorkflow({ callback_id: "sync_people_workflow", title: "사람 목록 맞추기", input_parameters: { properties: {}, required: [] } });
SyncPeopleWorkflow.addStep(SyncPeople, {});

export default SyncPeopleWorkflow;
