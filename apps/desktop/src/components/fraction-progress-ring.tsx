import { cn } from "@/lib/utils";

const RING_SIZE_PX = 13;
const RING_STROKE_PX = 1.75;
const RING_RADIUS = (RING_SIZE_PX - RING_STROKE_PX) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type FractionProgressRingProps = {
  completed: number;
  total: number;
  className?: string;
  strokeClassName?: string;
  trackClassName?: string;
  "aria-label"?: string;
};

export function FractionProgressRing({
  completed,
  total,
  className,
  strokeClassName = "stroke-muted-foreground",
  trackClassName = "stroke-muted-foreground/25",
  "aria-label": ariaLabel,
}: FractionProgressRingProps) {
  const safeTotal = total > 0 ? total : 1;
  const ratio = Math.min(Math.max(completed / safeTotal, 0), 1);
  const dashOffset = RING_CIRCUMFERENCE * (1 - ratio);

  return (
    <svg
      width={RING_SIZE_PX}
      height={RING_SIZE_PX}
      viewBox={`0 0 ${RING_SIZE_PX} ${RING_SIZE_PX}`}
      className={cn("shrink-0", className)}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <circle
        cx={RING_SIZE_PX / 2}
        cy={RING_SIZE_PX / 2}
        r={RING_RADIUS}
        fill="none"
        className={trackClassName}
        strokeWidth={RING_STROKE_PX}
      />
      <circle
        cx={RING_SIZE_PX / 2}
        cy={RING_SIZE_PX / 2}
        r={RING_RADIUS}
        fill="none"
        className={strokeClassName}
        strokeWidth={RING_STROKE_PX}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${RING_SIZE_PX / 2} ${RING_SIZE_PX / 2})`}
      />
    </svg>
  );
}
