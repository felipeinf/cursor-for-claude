import fs from "node:fs";
import process from "node:process";

export const SESSION_ID_ENV = "CURSOR_COMPANION_SESSION_ID";

export function nowIso() {
  return new Date().toISOString();
}

export function appendLogLine(logFile, message) {
  const normalized = String(message ?? "").trim();
  if (!logFile || !normalized) {
    return;
  }
  fs.appendFileSync(logFile, `[${nowIso()}] ${normalized}\n`, "utf8");
}

export function appendLogBlock(logFile, title, body) {
  if (!logFile || !body) {
    return;
  }
  fs.appendFileSync(logFile, `\n[${nowIso()}] ${title}\n${String(body).trimEnd()}\n`, "utf8");
}

export function getCurrentSessionId(env = process.env) {
  return env[SESSION_ID_ENV] ?? null;
}
