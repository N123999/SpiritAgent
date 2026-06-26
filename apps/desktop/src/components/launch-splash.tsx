import { useEffect, useLayoutEffect, useState } from "react";

import { SpiritGlassLogo, spiritGlassLogoMaskStyle } from "@/components/spirit-glass-logo";
import { syncLaunchSplashChromeToDocument } from "@/lib/desktop-shell";
import { cn } from "@/lib/utils";

const LAUNCH_LOGO_WIDTH_PX = 72;

const EXIT_MS = 520;

/** 加载结束后延迟再播退场（毫秒），0 表示立即退场 */
const EXIT_DELAY_BEFORE_MS = 0;

type Phase = "running" | "leaving" | "gone";

type LaunchSplashProps = {
  /** 为 true 时显示加载态；变为 false 时播放退场后卸载 */
  active: boolean;
  /** Windows Mica / macOS Vibrancy：与 app-shell 一致透出原生模糊 */
  useMicaBackdrop?: boolean;
};

/**
 * 首屏启动：居中品牌图标 + 骨架屏式线性闪光，宿主就绪后淡出。
 * Blur 开启时背景透明以透出系统材质；关闭时使用实色底。
 */
export function LaunchSplash({ active, useMicaBackdrop = false }: LaunchSplashProps) {
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

  useLayoutEffect(() => {
    syncLaunchSplashChromeToDocument(phase);
    return () => {
      syncLaunchSplashChromeToDocument("gone");
    };
  }, [phase]);

  if (phase === "gone") {
    return null;
  }

  const exiting = phase === "leaving";

  return (
    <div
      data-spirit-surface="launch-splash"
      aria-hidden={exiting}
      className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center",
        useMicaBackdrop ? "bg-transparent" : "bg-background",
        "transition-opacity duration-500 ease-out motion-reduce:duration-200",
        exiting ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <div
        className={cn(
          "relative shrink-0 transition-[opacity,transform] duration-[420ms] ease-out motion-reduce:duration-150",
          exiting ? "scale-[0.97] opacity-0 motion-reduce:scale-100" : "scale-100 opacity-100",
        )}
        style={{ width: LAUNCH_LOGO_WIDTH_PX }}
      >
        <SpiritGlassLogo width={LAUNCH_LOGO_WIDTH_PX} className="relative z-0" />
        <div
          className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
          style={spiritGlassLogoMaskStyle()}
          aria-hidden
        >
          <div className="spirit-launch-shimmer-sweep" />
        </div>
      </div>
    </div>
  );
}
