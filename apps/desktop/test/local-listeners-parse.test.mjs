import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractHtmlTitle,
  isHtmlContentType,
  isLikelyWebPage,
  isLocalhostReachableAddress,
  mergeLocalListeningEndpoints,
  parseSsOutput,
  parseWindowsNetstat,
  parseWindowsPowerShellListeners,
  parseUnixNetstat,
  probeHttpUrl,
} from "../electron/local-listeners.ts";

test("isLocalhostReachableAddress accepts localhost bindings", () => {
  assert.equal(isLocalhostReachableAddress("127.0.0.1"), true);
  assert.equal(isLocalhostReachableAddress("0.0.0.0"), true);
  assert.equal(isLocalhostReachableAddress("*"), true);
  assert.equal(isLocalhostReachableAddress("[::]"), true);
  assert.equal(isLocalhostReachableAddress("192.168.1.5"), false);
});

test("parseWindowsPowerShellListeners reads address and port", () => {
  const stdout = ["127.0.0.1|1420|1234", "0.0.0.0|7788|5678", "192.168.0.2|9000|1"].join("\n");
  const merged = mergeLocalListeningEndpoints(parseWindowsPowerShellListeners(stdout));
  assert.deepEqual(
    merged.map((item) => item.port),
    [1420, 7788],
  );
});

test("parseWindowsNetstat reads LISTENING rows", () => {
  const stdout = [
    "  TCP    127.0.0.1:1420         0.0.0.0:0              LISTENING       1234",
    "  TCP    0.0.0.0:7788           0.0.0.0:0              LISTENING       5678",
  ].join("\n");
  const merged = mergeLocalListeningEndpoints(parseWindowsNetstat(stdout));
  assert.deepEqual(
    merged.map((item) => item.port),
    [1420, 7788],
  );
});

test("parseSsOutput reads ss -tlnH rows", () => {
  const stdout = [
    "LISTEN 0      511        127.0.0.1:1420      0.0.0.0:*",
    "LISTEN 0      511                *:7788            *:*",
  ].join("\n");
  const merged = mergeLocalListeningEndpoints(parseSsOutput(stdout));
  assert.deepEqual(
    merged.map((item) => item.port),
    [1420, 7788],
  );
});

test("parseUnixNetstat reads darwin netstat rows", () => {
  const stdout = [
    "tcp4       0      0  127.0.0.1.8765         *.*                    LISTEN",
    "tcp46      0      0  *.7788                 *.*                    LISTEN",
  ].join("\n");
  const merged = mergeLocalListeningEndpoints(parseUnixNetstat(stdout));
  assert.deepEqual(
    merged.map((item) => item.port),
    [7788, 8765],
  );
});

test("mergeLocalListeningEndpoints dedupes by port", () => {
  const merged = mergeLocalListeningEndpoints([
    { address: "127.0.0.1", port: 3000 },
    { address: "0.0.0.0", port: 3000, processName: "node" },
    { address: "10.0.0.1", port: 4000 },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.port, 3000);
  assert.equal(merged[0]?.processName, "node");
});

test("probeHttpUrl rejects invalid url", async () => {
  assert.equal(await probeHttpUrl("not-a-url"), null);
});

test("isHtmlContentType accepts html and xhtml", () => {
  assert.equal(isHtmlContentType("text/html; charset=utf-8"), true);
  assert.equal(isHtmlContentType("application/xhtml+xml"), true);
  assert.equal(isHtmlContentType("application/json"), false);
});

test("extractHtmlTitle reads non-empty title", () => {
  assert.equal(
    extractHtmlTitle("<html><head><title>Spirit Agent</title></head></html>"),
    "Spirit Agent",
  );
  assert.equal(extractHtmlTitle("<html><head><title>  </title></head></html>"), null);
});

test("isLikelyWebPage accepts html content-type or titled body", () => {
  assert.equal(isLikelyWebPage("text/html", ""), true);
  assert.equal(
    isLikelyWebPage("application/json", '<html><title>Dashboard</title></html>'),
    true,
  );
  assert.equal(isLikelyWebPage("application/json", '{"ok":true}'), false);
});
