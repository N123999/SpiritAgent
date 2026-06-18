import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitize } from "hast-util-sanitize";

import {
  MANAGED_GENERATED_ASSET_SANITIZE_PROTOCOL,
  streamdownSanitizeSchema,
} from "../../src/lib/markdown-streamdown-plugins.ts";

test("streamdown sanitize schema keeps spirit-agent img src", () => {
  const ref =
    "spirit://generated/image/1780701216913-a51ab479-f44c-4efc-86f8-a0a2fe4f85e7.png";
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "img",
        properties: {
          src: ref,
          alt: "Generated image",
        },
        children: [],
      },
    ],
  };

  const safe = sanitize(tree, streamdownSanitizeSchema);
  const img = safe.children[0];
  assert.equal(img.tagName, "img");
  assert.equal(img.properties.src, ref);
});

test("streamdown sanitize schema keeps spirit-agent video src", () => {
  const ref = "spirit://generated/video/example.mp4";
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "video",
        properties: {
          src: ref,
          controls: true,
        },
        children: [],
      },
    ],
  };

  const safe = sanitize(tree, streamdownSanitizeSchema);
  const video = safe.children[0];
  assert.equal(video.tagName, "video");
  assert.equal(video.properties.src, ref);
});

test("streamdown sanitize schema still allows https image src", () => {
  const ref = "https://example.com/a.png";
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "img",
        properties: { src: ref, alt: "remote" },
        children: [],
      },
    ],
  };

  const safe = sanitize(tree, streamdownSanitizeSchema);
  assert.equal(safe.children[0].properties.src, ref);
});

test("default github schema strips spirit-agent src", () => {
  const ref = "spirit://generated/image/test.png";
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "img",
        properties: { src: ref, alt: "Generated image" },
        children: [],
      },
    ],
  };

  const safe = sanitize(tree);
  assert.equal(safe.children[0].properties.src, undefined);
  assert.equal(MANAGED_GENERATED_ASSET_SANITIZE_PROTOCOL, "spirit");
});
