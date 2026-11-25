// 폼 제출: 폼 id → 처리 함수
import { chooseWork, sync } from "./navigation.mjs";
import { formsPick, openFormsSettings } from "./settings.mjs";
import { state } from "./state.mjs";
import { $, api, closeDialog, notify } from "./ui.mjs";

const fieldValue = (id) => $(id).value;
export const workRef = () => ({ id: state.work.id, rev: state.work.rev }); // 서버가 최신 판인지 확인
const readIntake = (form) => Object.fromEntries(new FormData(form));

const forms = {
  login: async () => {
    await api("login", { code: fieldValue("accesscode") });
    closeDialog();
    notify("접속했습니다.");
  },
  "forms-config": async (form) => {
    await api("forms-settings", formsPick);
    notify("공모 연동 설정을 저장했습니다.");
    await openFormsSettings(); // 고른 곳에서 읽은 결과를 바로 보여 준다
    await sync(true);
  },
  "summary-config": async (form) => {
    await api("summary-token", { key: form.elements.token.value.trim(), baseUrl: fieldValue("aibase"), model: fieldValue("aimodel") });
    closeDialog();
    notify("요약 설정을 저장했습니다.");
  },
  create: async (form) => {
    const { id } = await api("create", { name: fieldValue("name"), ...readIntake(form) });
    closeDialog();
    await chooseWork(id);
  },
  "edit-intake": async (form) => {
    const { inExcel } = await api("intake", {
      id: form.dataset.id,
      intakeVersion: Number(form.dataset.version),
      ...readIntake(form),
    });
    closeDialog();
    notify(inExcel ? "접수 정보를 저장하고 응답 엑셀도 고쳤습니다." : "접수 정보를 저장했습니다.");
  },
  "review-note": async (form) => {
    await api("review-note", { id: state.work.id, note: form.elements.note.value });
    state.unsavedForm = false;
    notify("메모를 저장했습니다.");
    await sync(true);
  },
};

export async function onSubmit(e) {
  e.preventDefault();
  const submitter = e.submitter;
  if (submitter) submitter.disabled = true;
  try {
    await forms[e.target.id]?.(e.target);
    await sync(true);
  } finally {
    if (submitter) submitter.disabled = false;
  }
}

