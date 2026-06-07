import { useCallback, useEffect, useState } from "react";

/** 观测元素 border-box 高度（px，向上取整），供叠层与滚动区 padding 对齐。 */
export function useElementBoxHeight<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [heightPx, setHeightPx] = useState(0);
  const ref = useCallback((node: T | null) => {
    setElement(node);
  }, []);

  useEffect(() => {
    if (!element) {
      setHeightPx(0);
      return;
    }

    const syncHeight = () => {
      setHeightPx(Math.ceil(element.getBoundingClientRect().height));
    };

    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref, heightPx };
}
