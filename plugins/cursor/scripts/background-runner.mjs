#!/usr/bin/env node

import { readBackgroundPayload, runBackgroundChild } from "./lib/cursor.mjs";

try {
  const { opts, job } = readBackgroundPayload(process.argv[2] ?? "{}");
  await runBackgroundChild(opts, job);
} catch (error) {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
}
