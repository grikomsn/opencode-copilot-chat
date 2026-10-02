import assert from "node:assert/strict";
import test from "node:test";
import { OPENCODE_PROVIDER_DEFINITIONS, providerDefinition } from "./definitions";

test("defines distinct Console and Go model-provider groups", () => {
  assert.deepEqual(Object.keys(OPENCODE_PROVIDER_DEFINITIONS), ["console", "go"]);
  assert.deepEqual(
    Object.values(OPENCODE_PROVIDER_DEFINITIONS).map(({ vendor }) => vendor),
    ["opencodeconsole", "opencodego"],
  );
  assert.equal(providerDefinition("console").displayName, "OpenCode Console");
  assert.equal(providerDefinition("go").displayName, "OpenCode Go");
});
