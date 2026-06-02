import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeBrowserUrl, toLocalHostUrl } from "../src/lib/browser-url.ts";

test("toLocalHostUrl formats localhost url", () => {
  assert.equal(toLocalHostUrl(8080), "http://127.0.0.1:8080");
});

test("normalizeBrowserUrl accepts bare port", () => {
  assert.equal(normalizeBrowserUrl("8080"), "http://127.0.0.1:8080");
  assert.equal(normalizeBrowserUrl(":3000"), "http://127.0.0.1:3000");
});

test("normalizeBrowserUrl adds https for hostnames", () => {
  assert.equal(normalizeBrowserUrl("example.com"), "https://example.com/");
  assert.equal(normalizeBrowserUrl("https://example.com/path"), "https://example.com/path");
});

test("normalizeBrowserUrl treats localhost:port as host without scheme", () => {
  assert.equal(normalizeBrowserUrl("localhost:3000"), "https://localhost:3000/");
  assert.equal(normalizeBrowserUrl("127.0.0.1:8080"), "https://127.0.0.1:8080/");
});

test("normalizeBrowserUrl rejects invalid input", () => {
  assert.equal(normalizeBrowserUrl(""), null);
  assert.equal(normalizeBrowserUrl("ftp://example.com"), null);
  assert.equal(normalizeBrowserUrl("99999"), null);
});
