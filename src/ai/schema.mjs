// AI 응답 규격(JSON Schema) 도우미

// 모든 속성이 필수이고 다른 속성은 없는 객체
export const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
// 최대 maxItems개 배열
export const array = (items, maxItems) => ({ type: "array", items, maxItems });
export const string = { type: "string" };
