import { toast } from "sonner";

export function showDesktopErrorToast(message: string, id = "desktop-error") {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  toast.error(trimmed, { id });
}
