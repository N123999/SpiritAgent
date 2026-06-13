import { useEffect, useState } from 'react';

import { COLLAPSIBLE_CLOSE_UNMOUNT_DELAY_MS } from '@/lib/collapsible-animation';

/** 展开时立即挂载；收起后延迟卸载，与 AnimatedCollapse 收起动画对齐。 */
export function useCollapsibleChildMount(
  open: boolean,
  delayMs = COLLAPSIBLE_CLOSE_UNMOUNT_DELAY_MS,
): boolean {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), delayMs);
    return () => window.clearTimeout(timer);
  }, [open, delayMs]);

  return mounted;
}
