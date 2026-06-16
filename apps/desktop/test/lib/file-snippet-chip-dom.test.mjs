import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

const { window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.document = window.document;

const { domToSegments, segmentsToDom, segmentsToPlainText } = await import("../../src/lib/composer-segments.ts");

const sampleAttachment = {
  id: "file-dom-1",
  filePath: "apps/desktop/src/App.tsx",
  lineStart: 3,
  lineEnd: 7,
  selectedText: "line one\n```\nline two",
};

test("file snippet chip round-trips through domToSegments", () => {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const frag = segmentsToDom([{ kind: "fileSnippet", attachment: sampleAttachment }], document);
  const container = document.createElement("div");
  container.appendChild(frag);

  const parsed = domToSegments(container);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.kind, "fileSnippet");
  if (parsed[0]?.kind !== "fileSnippet") {
    return;
  }
  assert.equal(parsed[0].attachment.id, sampleAttachment.id);
  assert.equal(parsed[0].attachment.filePath, sampleAttachment.filePath);
  assert.equal(parsed[0].attachment.lineStart, sampleAttachment.lineStart);
  assert.equal(parsed[0].attachment.lineEnd, sampleAttachment.lineEnd);
  assert.equal(parsed[0].attachment.selectedText, sampleAttachment.selectedText);
});

test("file snippet chip preserves multiline selectedText in dataset", () => {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const attachment = {
    id: "file-dom-2",
    filePath: "README.md",
    lineStart: 0,
    lineEnd: 0,
    selectedText: "alpha\nbeta\ngamma",
  };
  const frag = segmentsToDom([{ kind: "fileSnippet", attachment }], document);
  const container = document.createElement("div");
  container.appendChild(frag);
  const parsed = domToSegments(container);
  assert.equal(parsed[0]?.kind, "fileSnippet");
  if (parsed[0]?.kind !== "fileSnippet") {
    return;
  }
  assert.equal(parsed[0].attachment.selectedText, attachment.selectedText);
});

test("domToSegments extracts text from browser-pasted styled span", () => {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const container = document.createElement("div");
  const span = document.createElement("span");
  span.textContent = "Concurrent";
  container.appendChild(span);

  const parsed = domToSegments(container);
  assert.equal(segmentsToPlainText(parsed), "Concurrent");
});
