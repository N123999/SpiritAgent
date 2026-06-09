import { useId, type CSSProperties, type SVGProps } from "react";

import { cn } from "@/lib/utils";

/** 与 spiritagent.app `glass-logo-showcase` 一致的品牌路径 */
export const SPIRIT_GLASS_LOGO_PATH =
  "M0 0L141.409 69.4512L70.7825 78.2408C61.5778 79.3863 53.5378 85.016 49.3132 93.2737L16.8979 156.635L0 0Z";

export const SPIRIT_GLASS_LOGO_VIEWBOX = { width: 142, height: 157 } as const;

const MASK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPIRIT_GLASS_LOGO_VIEWBOX.width} ${SPIRIT_GLASS_LOGO_VIEWBOX.height}"><path d="${SPIRIT_GLASS_LOGO_PATH}" fill="white"/></svg>`;

/** 供启动层 shimmer 蒙版：与玻璃标轮廓一致 */
export function spiritGlassLogoMaskStyle(): CSSProperties {
  const mask = `url("data:image/svg+xml,${encodeURIComponent(MASK_SVG)}")`;
  return {
    WebkitMaskImage: mask,
    maskImage: mask,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  };
}

type SpiritGlassLogoProps = Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox"> & {
  /** 渲染宽度（px）；高度按站点 CTA 比例推算 */
  width?: number;
};

/**
 * spiritagent.app 页脚 CTA 玻璃品牌标（无 shimmer）。
 * 源自 `glass-logo-showcase.tsx` 的静态图层。
 */
export function SpiritGlassLogo({ width = 72, className, ...props }: SpiritGlassLogoProps) {
  const uid = useId().replace(/:/g, "");
  const height = (width * SPIRIT_GLASS_LOGO_VIEWBOX.height) / SPIRIT_GLASS_LOGO_VIEWBOX.width;

  const fillId = `${uid}-fill`;
  const innerId = `${uid}-inner`;
  const fresnelId = `${uid}-fresnel`;
  const blurSmId = `${uid}-blur-sm`;
  const blurMdId = `${uid}-blur-md`;

  return (
    <svg
      viewBox={`0 0 ${SPIRIT_GLASS_LOGO_VIEWBOX.width} ${SPIRIT_GLASS_LOGO_VIEWBOX.height}`}
      width={width}
      height={height}
      aria-hidden
      className={cn("block overflow-visible select-none", className)}
      {...props}
    >
      <defs>
        <linearGradient id={fillId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.16)" />
          <stop offset="40%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(220,230,255,0.02)" />
        </linearGradient>

        <linearGradient id={innerId} x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
          <stop offset="45%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(200,220,255,0.03)" />
        </linearGradient>

        <linearGradient id={fresnelId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(190,215,255,0.35)" />
          <stop offset="25%" stopColor="rgba(255,200,200,0.1)" />
          <stop offset="55%" stopColor="rgba(200,255,215,0.1)" />
          <stop offset="100%" stopColor="rgba(215,200,255,0.25)" />
        </linearGradient>

        <filter id={blurSmId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
        <filter id={blurMdId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      <path d={SPIRIT_GLASS_LOGO_PATH} fill={`url(#${fillId})`} />
      <path d={SPIRIT_GLASS_LOGO_PATH} fill={`url(#${innerId})`} />

      <path
        d={SPIRIT_GLASS_LOGO_PATH}
        fill="none"
        stroke={`url(#${fresnelId})`}
        strokeWidth="3"
        opacity="0.18"
        filter={`url(#${blurMdId})`}
      />

      <path
        d={SPIRIT_GLASS_LOGO_PATH}
        fill="none"
        stroke="rgba(255,255,255,0.65)"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />

      <path
        d={SPIRIT_GLASS_LOGO_PATH}
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1.5"
        filter={`url(#${blurSmId})`}
        opacity="0.5"
      />
    </svg>
  );
}
