import assert from "node:assert/strict";
import test from "node:test";
import { OPENCODE_PROVIDER_DEFINITIONS, providerDefinition } from "./definitions";

test("defines distinct Zen, Go, and Console model-provider groups", () => {
  assert.deepEqual(Object.keys(OPENCODE_PROVIDER_DEFINITIONS), ["zen", "go", "console"]);
  assert.deepEqual(
    Object.values(OPENCODE_PROVIDER_DEFINITIONS).map(({ vendor }) => vendor),
    ["opencodezen", "opencodego", "opencodeconsole"],
  );
  assert.equal(providerDefinition("zen").displayName, "OpenCode Zen");
  assert.equal(providerDefinition("go").displayName, "OpenCode Go");
  assert.equal(providerDefinition("console").displayName, "OpenCode Console");
});
