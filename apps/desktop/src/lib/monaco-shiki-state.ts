let monacoShikiReady = false;

export function isMonacoShikiReady(): boolean {
  return monacoShikiReady;
}

export function setMonacoShikiReady(ready: boolean): void {
  monacoShikiReady = ready;
}
