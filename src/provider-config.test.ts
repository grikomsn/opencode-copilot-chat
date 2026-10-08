import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeConsoleProfileFromState, consoleProfileFromConfiguration, qualifiedModelId } from "./provider-profile";

test("declares native API-key and Console-profile provider entries", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      languageModelChatProviders: Array<Record<string, unknown>>;
    };
  };
  const providers = manifest.contributes.languageModelChatProviders;
  for (const vendor of ["opencodeconsole", "opencodego"]) {
    const provider = providers.find((item) => item.vendor === vendor);
    assert.ok(provider);
    assert.equal(provider.managementCommand, undefined);
    const configuration = provider.configuration as {
      required?: string[];
      properties?: Record<string, { secret?: boolean; pattern?: string }>;
    };
    // Both vendors accept either a service-account key or an account profile;
    // neither field is required so entries may also be keyless device
    // accounts. API-key entries validate the explicit entryId at provisioning.
    assert.equal(configuration.required, undefined);
    assert.equal(configuration.properties?.apiKey.secret, true);
    assert.match(configuration.properties?.profile.pattern ?? "", /^\^/);
    assert.equal(configuration.properties?.name, undefined);
    assert.match(configuration.properties?.entryId.pattern ?? "", /^\^/);
  }
  for (const command of ["opencodeCopilot.refreshModels", "opencodeCopilot.testConnection"]) {
    assert.match(
      manifest.contributes.commands.find((item) => item.command === command)?.title ?? "",
      /Active Console Profile/,
    );
  }
  assert.match(
    manifest.contributes.commands.find((item) => item.command === "opencodeCopilot.selectConsoleProfile")?.title ?? "",
    /Usage and Management/,
  );
});

test("qualifies model IDs and reports invalid saved Console profiles", () => {
  assert.equal(qualifiedModelId("profile-work", "openai/gpt-5", "console"), "profile-work::openai/gpt-5");
  assert.equal(qualifiedModelId("profile-default", "openai/gpt-5", "console"), "profile-default::openai/gpt-5");
  assert.equal(qualifiedModelId("legacy", "openai/gpt-5", "console"), "legacy::openai/gpt-5");
  // Valid IDs can name accounts not signed in yet.
  assert.equal(consoleProfileFromConfiguration({ profile: "wrk_01KQ25AJRFKQDYB04QPEM2PN5C" }), "wrk_01kq25ajrfkqdyb04qpem2pn5c");
});

test("restores only a valid persisted Console management profile", () => {
  assert.equal(activeConsoleProfileFromState("Work"), "work");
  assert.equal(activeConsoleProfileFromState("work profile"), "default");
  assert.equal(activeConsoleProfileFromState(undefined), "default");
});
