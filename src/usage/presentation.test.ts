import assert from "node:assert/strict";
import test from "node:test";
import { formatUsageRows, formatUsageStatus, formatUsageTooltip } from "./presentation";

test("formats an OpenCode usage status", () => {
  assert.equal(formatUsageStatus({ tracked: { requests: 2, inputTokens: 1_000, outputTokens: 234, totalTokens: 1_234 } }), "$(pulse) OpenCode 1.2K tokens");
  assert.equal(formatUsageStatus({ totalTokens: 123 }), "$(symbol-numeric) OpenCode 123 tokens");
  assert.equal(formatUsageStatus({}), "$(cloud) OpenCode");
});

test("formats usage tooltip details and the empty state", () => {
  assert.match(formatUsageTooltip({}), /No inference usage/);
  const tooltip = formatUsageTooltip({ updatedAt: Date.now(), model: "Muse Spark 1.2", inputTokens: 120, outputTokens: 30 });
  assert.match(tooltip, /OpenCode usage/);
  assert.match(tooltip, /Last model: Muse Spark 1\.2/);
  assert.match(tooltip, /Last request: 120 input · 30 output/);
});

test("formats tracked and latest-request usage rows", () => {
  const rows = formatUsageRows({
    model: "minimax-m3",
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    tracked: { requests: 3, inputTokens: 300, outputTokens: 120, totalTokens: 420 },
  });
  assert.deepEqual(rows.map((row) => row.kind), ["tracked", "request"]);
  assert.match(rows[0].description, /420 tokens across 3 requests/);
});
