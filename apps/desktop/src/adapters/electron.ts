import type { HostApi } from '../host-api';

export async function createElectronHostApi(): Promise<HostApi> {
  if (typeof window === 'undefined' || !window.spiritDesktop) {
    throw new Error('Electron host bridge is unavailable.');
  }

  const bridge = window.spiritDesktop;

  return {
    kind: 'electron',
    bootstrap(request) {
      return bridge.bootstrap(request);
    },
    updateConfig(request) {
      return bridge.updateConfig(request);
    },
    addModel(request) {
      return bridge.addModel(request);
    },
    removeModel(name) {
      return bridge.removeModel(name);
    },
    createSkill(request) {
      return bridge.createSkill(request);
    },
    deleteSkill(request) {
      return bridge.deleteSkill(request);
    },
    submitSkillSlash(request) {
      return bridge.submitSkillSlash(request);
    },
    submitUserTurn(text) {
      return bridge.submitUserTurn(text);
    },
    rewindAndSubmitMessage(request) {
      return bridge.rewindAndSubmitMessage(request);
    },
    poll() {
      return bridge.poll();
    },
    replyPendingApproval(message) {
      return bridge.replyPendingApproval(message);
    },
    replyPendingQuestions(result) {
      return bridge.replyPendingQuestions(result);
    },
    resetSession() {
      return bridge.resetSession();
    },
    listSessions() {
      return bridge.listSessions();
    },
    openSession(path) {
      return bridge.openSession(path);
    },
  };
}