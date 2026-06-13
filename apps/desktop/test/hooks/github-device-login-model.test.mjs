import assert from "node:assert/strict";
import { test } from "node:test";

import { GitHubDeviceLoginModel } from "../../src/hooks/github-device-login-model.ts";

const SAMPLE_CHALLENGE = {
  deviceCode: "device-code",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 5,
};

const CONNECTED_STATUS = { connected: true, login: "octocat" };

function createDeferred() {
  /** @type {(value: unknown) => void} */
  let resolve;
  /** @type {(reason?: unknown) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRuntime(overrides = {}) {
  return {
    getGitHubAuthStatus: async () => ({ connected: false }),
    beginGitHubDeviceLogin: async () => SAMPLE_CHALLENGE,
    completeGitHubDeviceLogin: async () => CONNECTED_STATUS,
    cancelGitHubDeviceLogin: async () => {},
    disconnectGitHub: async () => ({ connected: false }),
    ...overrides,
  };
}

test("startConnect transitions loading → challenge → success", async () => {
  const completeDeferred = createDeferred();
  const runtime = createRuntime({
    beginGitHubDeviceLogin: async () => SAMPLE_CHALLENGE,
    completeGitHubDeviceLogin: () => completeDeferred.promise,
  });
  const model = new GitHubDeviceLoginModel(runtime);

  const connectPromise = model.startConnect();
  assert.equal(model.loadingAuth, true);
  assert.equal(model.deviceChallenge, null);

  await Promise.resolve();
  assert.equal(model.loadingAuth, true);
  assert.deepEqual(model.deviceChallenge, SAMPLE_CHALLENGE);
  assert.equal(model.error, null);

  completeDeferred.resolve(CONNECTED_STATUS);
  const result = await connectPromise;

  assert.deepEqual(result, CONNECTED_STATUS);
  assert.deepEqual(model.authStatus, CONNECTED_STATUS);
  assert.equal(model.loadingAuth, false);
  assert.deepEqual(model.deviceChallenge, SAMPLE_CHALLENGE);
  assert.equal(model.error, null);
});

test("startConnect records error when begin fails", async () => {
  const runtime = createRuntime({
    beginGitHubDeviceLogin: async () => {
      throw new Error("begin failed");
    },
  });
  const model = new GitHubDeviceLoginModel(runtime);

  const result = await model.startConnect();

  assert.equal(result, null);
  assert.equal(model.loadingAuth, false);
  assert.equal(model.deviceChallenge, null);
  assert.equal(model.error, "begin failed");
});

test("cancelConnect clears challenge and stops loading", async () => {
  const runtime = createRuntime({
    cancelGitHubDeviceLogin: async () => {},
  });
  const model = new GitHubDeviceLoginModel(runtime);
  model.loadingAuth = true;
  model.deviceChallenge = SAMPLE_CHALLENGE;

  await model.cancelConnect();

  assert.equal(model.loadingAuth, false);
  assert.equal(model.deviceChallenge, null);
  assert.equal(model.error, null);
});

test("cancelConnect records error from runtime", async () => {
  const runtime = createRuntime({
    cancelGitHubDeviceLogin: async () => {
      throw new Error("cancel failed");
    },
  });
  const model = new GitHubDeviceLoginModel(runtime);
  model.deviceChallenge = SAMPLE_CHALLENGE;

  await model.cancelConnect();

  assert.equal(model.error, "cancel failed");
  assert.equal(model.deviceChallenge, null);
  assert.equal(model.loadingAuth, false);
});

test("disconnect updates auth status", async () => {
  const runtime = createRuntime({
    disconnectGitHub: async () => ({ connected: false }),
  });
  const model = new GitHubDeviceLoginModel(runtime);
  model.authStatus = CONNECTED_STATUS;

  const result = await model.disconnect();

  assert.deepEqual(result, { connected: false });
  assert.deepEqual(model.authStatus, { connected: false });
  assert.equal(model.loadingAuth, false);
});

test("refreshAuthStatus loads connected status", async () => {
  const runtime = createRuntime({
    getGitHubAuthStatus: async () => CONNECTED_STATUS,
  });
  const model = new GitHubDeviceLoginModel(runtime);

  await model.refreshAuthStatus();

  assert.deepEqual(model.authStatus, CONNECTED_STATUS);
  assert.equal(model.error, null);
});
