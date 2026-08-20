import assert from "node:assert/strict";
import test from "node:test";
import { chatContent } from "./content";

test("uses an empty string for textless Chat Completions content", () => {
  assert.equal(chatContent("", []), "");
});

test("preserves text and image content parts", () => {
  const image = { type: "image_url" as const, image_url: { url: "data:image/png;base64,AA==" } };
  assert.deepEqual(chatContent("Describe this image", [image]), [
    { type: "text", text: "Describe this image" },
    image,
  ]);
});
