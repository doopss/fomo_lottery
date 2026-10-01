export interface DrawWindowSpan {
  start: Date;
  end: Date;
}

export interface SchedulerHandlers {
  onOpen(window: DrawWindowSpan): Promise<void>;
  onClose(window: DrawWindowSpan): Promise<void>;
}

export interface Scheduler {
  start(): void;
  stop(): void;
}

type CancelTimer = () => void;

/**
 * Fixed-length windows aligned to the Unix epoch.
 * A 6-hour setting yields [00:00, 06:00), [06:00, 12:00), and so on, in UTC.
 * `window_end` in this stub is the exclusive boundary instant: close fires then,
 * and the next window opens at the same instant.
 */
export function readWindowHours(raw: string | undefined): number {
  const value = raw ?? "6";
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("DRAW_WINDOW_HOURS must be a positive integer");
  }
  return Number(value);
}

export function windowLengthMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

export function windowAt(time: Date, hours: number): DrawWindowSpan {
  const length = windowLengthMs(hours);
  const startMs = Math.floor(time.getTime() / length) * length;
  return {
    start: new Date(startMs),
    end: new Date(startMs + length),
  };
}

export function createScheduler(options: {
  windowHours: number;
  handlers: SchedulerHandlers;
  now?: () => Date;
  setTimer?: (callback: () => void, delayMs: number) => CancelTimer;
}): Scheduler {
  const now = options.now ?? (() => new Date());
  const setTimer =
    options.setTimer ??
    ((callback, delayMs) => {
      const id = setTimeout(callback, delayMs);
      return () => clearTimeout(id);
    });

  let cancel: CancelTimer | null = null;
  let stopped = true;

  function arm(window: DrawWindowSpan): void {
    if (stopped) {
      return;
    }
    const delay = Math.max(0, window.end.getTime() - now().getTime());
    cancel = setTimer(() => {
      void (async () => {
        await options.handlers.onClose(window);
        if (stopped) {
          return;
        }
        const next: DrawWindowSpan = {
          start: window.end,
          end: new Date(window.end.getTime() + windowLengthMs(options.windowHours)),
        };
        await options.handlers.onOpen(next);
        arm(next);
      })();
    }, delay);
  }

  return {
    start() {
      stopped = false;
      const current = windowAt(now(), options.windowHours);
      void options.handlers.onOpen(current).then(() => {
        arm(current);
      });
    },
    stop() {
      stopped = true;
      cancel?.();
      cancel = null;
    },
  };
}
