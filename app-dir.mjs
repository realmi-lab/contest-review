// 이 앱의 데이터 폴더. 맥: ~/Library/Application Support/<name>, 윈도우: %APPDATA%\\<name>
import os from "node:os";
import path from "node:path";

export const appDir = (name) =>
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), name)
    : path.join(os.homedir(), "Library", "Application Support", name);
