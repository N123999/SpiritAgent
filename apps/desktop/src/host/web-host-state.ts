import type {
  DesktopWebHostPolicySnapshot,
  DesktopWebHostStatusSnapshot,
} from '../types.js';
import { DEFAULT_DESKTOP_WEB_HOST, DEFAULT_DESKTOP_WEB_PORT } from './storage.js';

export const DESKTOP_WEB_HOST_POLICY: DesktopWebHostPolicySnapshot = {
  healthRequiresAuth: true,
  cors: 'same-origin',
  allowHttpLan: true,
  allowRemoteControl: true,
};

let runtimeStatus: DesktopWebHostStatusSnapshot = {
  state: 'stopped',
  host: DEFAULT_DESKTOP_WEB_HOST,
  port: DEFAULT_DESKTOP_WEB_PORT,
};

export function setDesktopWebHostRuntimeStatus(
  status: DesktopWebHostStatusSnapshot,
): void {
  runtimeStatus = { ...status };
}

export function getDesktopWebHostRuntimeStatus(): DesktopWebHostStatusSnapshot {
  return { ...runtimeStatus };
}
