import cron from "node-cron";
import { runSimplefinSync } from "./simplefin-sync";

// Every 4 hours - well inside SimpleFin's shared ~24 req/day quota, and
// SimpleFin's own upstream data only refreshes about once a day anyway, so
// polling more often than this buys nothing.
const SCHEDULE = "0 */4 * * *";

console.log(`worker: scheduling SimpleFin sync (${SCHEDULE})`);

cron.schedule(SCHEDULE, async () => {
  console.log("worker: running scheduled SimpleFin sync");
  try {
    await runSimplefinSync();
    console.log("worker: sync complete");
  } catch (error) {
    console.error("worker: sync failed", error);
  }
});
