import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("declares native API-key and Console-profile provider entries", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { languageModelChatProviders: Array<Record<string, unknown>> };
  };
  const providers = manifest.contributes.languageModelChatProviders;
  for (const vendor of ["opencodezen", "opencodego", "opencodeconsole"]) {
    const provider = providers.find((item) => item.vendor === vendor);
    assert.ok(provider);
    assert.equal(provider.managementCommand, undefined);
    const configuration = provider.configuration as {
      required?: string[];
      properties?: Record<string, { secret?: boolean }>;
    };
    const required = configuration.required;
    assert.deepEqual(required, [vendor === "opencodeconsole" ? "profile" : "apiKey"]);
    if (vendor !== "opencodeconsole") assert.equal(configuration.properties?.apiKey.secret, true);
  }
});
