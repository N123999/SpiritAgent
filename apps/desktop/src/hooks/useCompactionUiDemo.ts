import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildCompactionDemoMessages,
  buildCompactionDemoPendingAux,
  type CompactionUiDemoPhase,
} from '@/lib/compaction-ui-demo';
import type { ConversationMessageSnapshot, PendingAssistantAux } from '@/types';

const SPINNER_MS = 180;
const STREAM_TICK_MS = 45;
const PHASE_DELAYS_MS = {
  spinner: 900,
  streaming: 2200,
  finalized: 1400,
} as const;

export function useCompactionUiDemo() {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<CompactionUiDemoPhase>('idle');
  const [tick, setTick] = useState(0);
  const [streamProgress, setStreamProgress] = useState(0);
  const phaseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const spinnerTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const clearPhaseTimers = useCallback(() => {
    for (const timer of phaseTimersRef.current) {
      clearTimeout(timer);
    }
    phaseTimersRef.current = [];
  }, []);

  const clearMotionTimers = useCallback(() => {
    if (spinnerTimerRef.current !== undefined) {
      clearInterval(spinnerTimerRef.current);
      spinnerTimerRef.current = undefined;
    }
    if (streamTimerRef.current !== undefined) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = undefined;
    }
  }, []);

  const stop = useCallback(() => {
    clearPhaseTimers();
    clearMotionTimers();
    setActive(false);
    setPhase('idle');
    setTick(0);
    setStreamProgress(0);
  }, [clearMotionTimers, clearPhaseTimers]);

  const start = useCallback(() => {
    stop();
    setActive(true);
    setPhase('spinner');
    setTick(0);
    setStreamProgress(0);

    spinnerTimerRef.current = setInterval(() => {
      setTick((current) => current + 1);
    }, SPINNER_MS);

    phaseTimersRef.current.push(
      setTimeout(() => {
        setPhase('streaming');
        setStreamProgress(0);
        streamTimerRef.current = setInterval(() => {
          setStreamProgress((current) => {
            const next = Math.min(1, current + 0.06);
            if (next >= 1 && streamTimerRef.current !== undefined) {
              clearInterval(streamTimerRef.current);
              streamTimerRef.current = undefined;
            }
            return next;
          });
        }, STREAM_TICK_MS);
      }, PHASE_DELAYS_MS.spinner),
      setTimeout(() => {
        setPhase('finalized');
        clearMotionTimers();
      }, PHASE_DELAYS_MS.spinner + PHASE_DELAYS_MS.streaming),
      setTimeout(() => {
        setPhase('complete');
      }, PHASE_DELAYS_MS.spinner + PHASE_DELAYS_MS.streaming + PHASE_DELAYS_MS.finalized),
    );
  }, [clearMotionTimers, stop]);

  useEffect(() => () => {
    clearPhaseTimers();
    clearMotionTimers();
  }, [clearMotionTimers, clearPhaseTimers]);

  const messages = useMemo(
    () =>
      active
        ? buildCompactionDemoMessages({ phase, tick, streamProgress })
        : ([] as ConversationMessageSnapshot[]),
    [active, phase, streamProgress, tick],
  );

  const pendingAuxState = useMemo((): PendingAssistantAux | undefined => {
    if (!active) {
      return undefined;
    }
    if (phase === 'spinner') {
      return buildCompactionDemoPendingAux(tick);
    }
    if (phase === 'streaming') {
      return buildCompactionDemoPendingAux(
        tick,
        buildCompactionDemoMessages({ phase, tick, streamProgress }).find(
          (message) => message.aux?.compaction,
        )?.aux?.compaction,
      );
    }
    return undefined;
  }, [active, phase, streamProgress, tick]);

  return {
    active,
    phase,
    messages,
    pendingAuxState,
    start,
    stop,
  };
}
