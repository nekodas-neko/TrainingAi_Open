'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { RefreshCwIcon } from 'lucide-react';
import { cn } from '@trainingai/shared/utils';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { syncOuraRing } from '@/lib/oura-ble/sync';
import { useScrollRestoration } from '@/lib/hooks/use-scroll-restoration';

const THRESHOLD = 100;  // indicator px needed to trigger sync (200px physical drag)
const MAX_PULL = 130;   // max indicator height
const RESISTANCE = 0.5; // finger travel is multiplied by this
// Min downward movement before we commit to pull-to-refresh and call preventDefault.
// 36px threshold prevents accidental triggers on normal scroll bounces.
const DIRECTION_THRESHOLD = 36;

type Phase = 'idle' | 'pulling' | 'ready' | 'syncing';

interface PullToSyncProps {
  onSync: () => Promise<void>;
  children: React.ReactNode;
  /** className forwarded to the inner scrollable div */
  scrollClassName?: string;
  /** style forwarded to the inner scrollable div */
  scrollStyle?: React.CSSProperties;
  /** className for the outer container (default: 'flex-1 flex flex-col') */
  className?: string;
  /** Distinguishes two scrollers on one route (BF-100). Health renders three — one per tab — so
   *  without this they would share a saved offset and restore each other's. */
  scrollKey?: string;
}

export function PullToSync({
  onSync,
  children,
  scrollClassName,
  scrollStyle,
  className = 'flex-1 flex flex-col overflow-hidden',
  scrollKey,
}: PullToSyncProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // BF-100. The app scrolls this container, not the document, so Next's own restoration cannot see
  // it — measured: on a push-and-back the container reads 0 while the document reads 0 throughout.
  // Here rather than in 62 screens, because every screen using the shell inherits it.
  useScrollRestoration(scrollRef, scrollKey);
  const isPulling = useRef(false);
  const isSyncing = useRef(false);
  const phaseRef = useRef<Phase>('idle');

  const pullY = useMotionValue(0);
  const [phase, setPhase] = useState<Phase>('idle');

  const updatePhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const triggerSync = useCallback(async () => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    isPulling.current = false;
    updatePhase('syncing');
    await animate(pullY, THRESHOLD, { duration: 0.12 });
    // Fire sync in background — don't block on it. Also force an immediate ring drain
    // so a manual pull pulls the ring's latest recorded data, not just the app's outbox.
    onSync().catch(() => {});
    void syncOuraRing();
    // Show indicator briefly then dismiss; sync continues silently
    await new Promise<void>(r => setTimeout(r, 650));
    hapticSuccess();
    await animate(pullY, 0, { duration: 0.35, ease: 'easeOut' });
    isSyncing.current = false;
    updatePhase('idle');
  }, [onSync, pullY, updatePhase]);

  useEffect(() => {
    if (!scrollRef.current) return;
    const el: HTMLDivElement = scrollRef.current;

    let touchStartY = 0;
    // Direction lock: 'none' until first clear movement is detected.
    // 'pull'   = confirmed downward gesture, preventDefault called to grow indicator.
    // 'scroll' = confirmed upward gesture, preventDefault never called this sequence.
    let directionLock: 'none' | 'pull' | 'scroll' = 'none';

    function onTouchStart(e: TouchEvent) {
      if (isSyncing.current) return;
      if (el.scrollTop > 2) return;
      touchStartY = e.touches[0].clientY;
      directionLock = 'none';
      isPulling.current = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (isSyncing.current) return;

      // Abort pull mode if user has scrolled away from the top mid-gesture
      if (el.scrollTop > 2) {
        if (isPulling.current) {
          isPulling.current = false;
          animate(pullY, 0, { duration: 0.2 });
          updatePhase('idle');
        }
        return;
      }

      // Only process gestures that started at the top
      if (!touchStartY) return;

      const delta = e.touches[0].clientY - touchStartY;

      if (directionLock === 'none') {
        if (delta < 0) {
          // First clear movement is upward — user is scrolling content down.
          // Lock to scroll mode: never call preventDefault this touch sequence.
          directionLock = 'scroll';
          return;
        }
        // Positive delta but below threshold — ambiguous jitter, wait for more.
        if (delta < DIRECTION_THRESHOLD) return;
        // Sustained downward movement past threshold — confirmed pull gesture.
        directionLock = 'pull';
        isPulling.current = true;
      }

      if (directionLock === 'scroll') return;
      if (!isPulling.current) return;

      // Block native scroll so the pull indicator can grow instead
      e.preventDefault();
      const capped = Math.min(delta * RESISTANCE, MAX_PULL);
      pullY.set(capped);
      const next: Phase = capped >= THRESHOLD ? 'ready' : 'pulling';
      if (phaseRef.current !== next) {
        if (next === 'ready') hapticLight();
        updatePhase(next);
      }
    }

    function onTouchEnd() {
      touchStartY = 0;
      directionLock = 'none';
      if (!isPulling.current || isSyncing.current) return;
      isPulling.current = false;
      if (phaseRef.current === 'ready') {
        triggerSync();
      } else {
        animate(pullY, 0, { duration: 0.25, ease: 'easeOut' });
        updatePhase('idle');
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [pullY, triggerSync, updatePhase]);

  const indicatorHeight = useTransform(pullY, [0, MAX_PULL], [0, MAX_PULL]);
  const contentOpacity = useTransform(pullY, [0, 16, THRESHOLD], [0, 0.6, 1]);
  const iconScale = useTransform(pullY, [0, THRESHOLD], [0.5, 1]);
  // Icon rotates 180° as you pull, snaps to spinning when syncing
  const iconRotation = useTransform(pullY, [0, THRESHOLD * 2], [0, 360]);

  return (
    <div className={className}>
      {/* Pull indicator — zero height when idle, grows with finger drag */}
      <motion.div
        style={{ height: indicatorHeight }}
        className="shrink-0 flex items-end justify-center pb-1.5 overflow-hidden"
      >
        <motion.div
          style={{ opacity: contentOpacity, scale: iconScale }}
          className="flex flex-col items-center gap-0.5"
        >
          <motion.div style={phase === 'syncing' ? undefined : { rotate: iconRotation }}>
            <RefreshCwIcon
              className={cn('h-4 w-4', phase === 'ready' ? 'text-brand' : 'text-muted-foreground', phase === 'syncing' && 'animate-spin text-brand')}
            />
          </motion.div>
          <span
            className={cn(
              'text-[10px] font-semibold tracking-wide uppercase',
              phase === 'ready' || phase === 'syncing' ? 'text-brand' : 'text-muted-foreground',
            )}
          >
            {phase === 'syncing' ? 'Syncing…' : phase === 'ready' ? 'Release to sync' : 'Pull to sync'}
          </span>
        </motion.div>
      </motion.div>

      {/* Scrollable content */}
      <div ref={scrollRef} className={cn(scrollClassName, 'scrollbar-hide')} style={scrollStyle}>
        {children}
      </div>
    </div>
  );
}
