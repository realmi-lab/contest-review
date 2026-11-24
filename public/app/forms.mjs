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
  rubric: async () => {
    const criteria = [...$("criteria").children].map((row) =>
      Object.fromEntries(
        [...row.querySelectorAll("[data-k]")].map((el) => [
          el.dataset.k,
          el.dataset.k === "weight" ? Number(el.value) : el.value,
        ]),
      ),
    );
    await api("settings", {
      ...workRef(),
      complete: state.work.complete,
      rubric: { categories: state.work.rubric.categories, criteria },
    });
    notify("이 작품의 기준을 저장했습니다.");
  },
  final: async (form) => {
    const picked = (name) => [...form.querySelectorAll(`[name=${name}]:checked`)].map((x) => x.value);
    await api("final", {
      ...workRef(),
      scores: [...form.querySelectorAll("[name=score]")].map((x) => Number(x.value)),
      checks: picked("check"),
      scale: picked("scale")[0],
      decision: picked("decision")[0],
      department: fieldValue("sheetdept"),
      feedback: fieldValue("sheetfeedback"),
      note: fieldValue("finalnote"),
      by: fieldValue("sheetby"),
      base: form.dataset.base || null, // 연 뒤에 다른 평가자가 바꿨으면 서버가 거절한다
    });
    localStorage.setItem("review.evaluator", fieldValue("sheetby"));
    state.editingSheet = false;
    state.stampNext = true;
    notify("채점표를 확정했습니다.");
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

