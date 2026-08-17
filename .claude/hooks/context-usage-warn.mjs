#!/usr/bin/env node
// Stop hook: warns once when the session's context window crosses a usage
// threshold, so there's time to run the `handoff` skill and switch sessions
// before auto-compaction drops context.
//
// It measures CONTEXT-WINDOW fullness (input + cache-creation + cache-read
// tokens on the latest assistant turn), which is what forces compaction — not
// the subscription rate-limit meter, which isn't exposed to hooks.
//
// Always exits 0 and never blocks: a monitoring warning must never wedge a turn.

import fs from "node:fs";

// 1M, not 200k: sessions run on a 1M-token window, so the old default reported
// ~111% at 222k tokens (22% of the real window) and fired the wrap-up warning
// while there was still most of a session left.
const WINDOW = Number(process.env.CONTEXT_WINDOW_TOKENS || 1_000_000);
// Warn at each of these once; later thresholds re-fire even after an earlier one.
const THRESHOLDS = [90, 95];

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function latestContextTokens(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  let tokens = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const u = obj?.message?.usage;
    if (!u) continue;
    const total =
      (u.input_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
    if (total > 0) tokens = total; // context grows over the turn — take the latest
  }
  return tokens;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0);
  }

  const transcriptPath = input.transcript_path;
  const sessionId = input.session_id || "unknown";
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

  let tokens;
  try {
    tokens = latestContextTokens(transcriptPath);
  } catch {
    process.exit(0);
  }
  if (!tokens) process.exit(0);

  const pct = Math.round((tokens / WINDOW) * 100);

  // Every crossed threshold not yet warned this session. If several cross at
  // once (a big jump), warn on the highest and mark all of them so none re-fire.
  const tmp = process.env.TMPDIR || "/tmp";
  const fresh = THRESHOLDS.filter(
    (t) => pct >= t && !fs.existsSync(`${tmp}/ctx-warn-${sessionId}-${t}`),
  );
  if (!fresh.length) process.exit(0);

  for (const t of fresh) {
    try {
      fs.writeFileSync(`${tmp}/ctx-warn-${sessionId}-${t}`, "1");
    } catch {
      /* best effort */
    }
  }

  const k = (n) => `${Math.round(n / 1000)}k`;
  const msg =
    `⚠️ Session context at ~${pct}% (${k(tokens)}/${k(WINDOW)} tokens). ` +
    `Wrap up soon: invoke the \`handoff\` skill to write docs/handoff-<date>-<title>.md ` +
    `(commit + push it), then start a fresh session and read that doc first. ` +
    `Warnings resume at the next threshold (${THRESHOLDS.join("%, ")}%).`;

  process.stdout.write(JSON.stringify({ systemMessage: msg }));
  process.exit(0);
}

main();
