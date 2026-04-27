import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

let monacoWorkersConfigured = false;

/** 须在首次 `monaco.editor.create` 之前调用一次。 */
export function ensureMonacoWorkers(): void {
  if (monacoWorkersConfigured || typeof globalThis === "undefined") {
    return;
  }
  monacoWorkersConfigured = true;
  (
    globalThis as unknown as {
      MonacoEnvironment: { getWorker: (_workerId: string, _label: string) => Worker };
    }
  ).MonacoEnvironment = {
    getWorker() {
      return new EditorWorker();
    },
  };
}
