import { createScheduler, readWindowHours } from "./scheduler.js";

if (process.env.DRAW_SCHEDULER_ENABLED !== "true") {
  console.log("job runner idle; scheduler stub not started (set DRAW_SCHEDULER_ENABLED=true to tick)");
} else {
  const hours = readWindowHours(process.env.DRAW_WINDOW_HOURS);
  const scheduler = createScheduler({
    windowHours: hours,
    handlers: {
      async onOpen(window) {
        console.log(`open ${window.start.toISOString()} -> ${window.end.toISOString()}`);
      },
      async onClose(window) {
        console.log(`close ${window.start.toISOString()} -> ${window.end.toISOString()}`);
      },
    },
  });
  scheduler.start();
  console.log(`scheduler stub running; ${hours}h windows aligned to the unix epoch`);
}
