import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = path.join(os.homedir(), ".ispeed");
const file = path.join(directory, "history.json");

export function readHistory() {
  try {
    const entries = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function appendHistory(result) {
  const history = readHistory();
  history.push(result);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(history, null, 2)}\n`);
  return history;
}
