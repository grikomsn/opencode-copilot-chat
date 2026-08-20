import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { consoleProfileFromConfiguration, qualifiedModelId } from "./provider-profile";

test("declares native API-key and Console-profile provider entries", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      languageModelChatProviders: Array<Record<string, unknown>>;
    };
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
  for (const command of ["opencodeCopilot.refreshModels", "opencodeCopilot.testConnection"]) {
    assert.match(
      manifest.contributes.commands.find((item) => item.command === command)?.title ?? "",
      /Legacy Key \/ Active Console Profile/,
    );
  }
});

test("qualifies model IDs and reports invalid saved Console profiles", () => {
  assert.equal(qualifiedModelId("profile-work", "openai/gpt-5"), "profile-work::openai/gpt-5");
  assert.equal(qualifiedModelId("profile-default", "openai/gpt-5"), "openai/gpt-5");
  assert.equal(qualifiedModelId("legacy", "openai/gpt-5"), "openai/gpt-5");
  assert.throws(
    () => consoleProfileFromConfiguration({ profile: "work profile" }),
    /Update this provider entry in Manage Language Models/,
  );
});
