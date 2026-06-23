import { useEffect } from "react";

import { showDesktopErrorToast } from "@/lib/desktop-error-toast";

export function useDesktopRuntimeErrorToast(runtimeError: string) {
  useEffect(() => {
    showDesktopErrorToast(runtimeError, "desktop-runtime-error");
  }, [runtimeError]);
}
