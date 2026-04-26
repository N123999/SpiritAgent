import { useEffect, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

const EXIT_MS = 520;

/** 加载结束后延迟再播退场（毫秒），0 表示立即退场 */
const EXIT_DELAY_BEFORE_MS = 0;

const ICON_SRC = "/spirit-agent-icon.png";

type Phase = "running" | "leaving" | "gone";

type LaunchSplashProps = {
  /** 为 true 时显示加载态；变为 false 时播放退场后卸载 */
  active: boolean;
};

const iconMaskStyle: CSSProperties = {
  WebkitMaskImage: `url(${ICON_SRC})`,
  maskImage: `url(${ICON_SRC})`,
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
};

/**
 * 首屏启动：居中品牌图标 + 骨架屏式线性闪光，宿主就绪后淡出。
 */
export function LaunchSplash({ active }: LaunchSplashProps) {
  const [phase, setPhase] = useState<Phase>(() => (active ? "running" : "gone"));

  useEffect(() => {
    if (active) {
      setPhase("running");
      return;
    }
    const id = window.setTimeout(() => {
      setPhase((current) => {
        if (current === "running" || current === "leaving") {
          return "leaving";
        }
        return current;
      });
    }, EXIT_DELAY_BEFORE_MS);
    return () => window.clearTimeout(id);
  }, [active]);

  useEffect(() => {
    if (phase !== "leaving") {
      return;
    }
    const id = window.setTimeout(() => {
      setPhase("gone");
    }, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  if (phase === "gone") {
    return null;
  }

  const exiting = phase === "leaving";

  return (
    <div
      aria-hidden={exiting}
      className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center bg-background",
        "transition-opacity duration-500 ease-out motion-reduce:duration-200",
        exiting ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <div
        className={cn(
          "relative size-[4.5rem] shrink-0 transition-[opacity,transform] duration-[420ms] ease-out motion-reduce:duration-150",
          exiting ? "scale-[0.97] opacity-0 motion-reduce:scale-100" : "scale-100 opacity-100",
        )}
      >
        <img
          src={ICON_SRC}
          alt=""
          width={72}
          height={72}
          draggable={false}
          className="block size-full object-contain select-none"
        />
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={iconMaskStyle}
          aria-hidden
        >
          <div className="spirit-launch-shimmer-sweep" />
        </div>
      </div>
    </div>
  );
}
