import pg from "pg";
import { loadEnv } from "@viadent/db";
import { processOutbox, scanAllTenants } from "./jobs.js";

loadEnv();
const url = process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("WORKER_DATABASE_URL tanımlı değil (.env.example)");
const pool = new pg.Pool({ connectionString: url, max: 4, application_name: "viadent-worker" });
// Boştaki bağlantı DB tarafından kapatılırsa (yeniden başlatma, failover) süreç çökmez; havuz yeni bağlantı açar.
pool.on("error", (e) => console.error(`[worker] boşta bağlantı hatası: ${e.message.slice(0, 120)}`));
let stopping = false;
let lastScan = 0;

async function loop() {
  while (!stopping) {
    try {
      const n = await processOutbox(pool);
      if (Date.now() - lastScan > 60_000) {
        await scanAllTenants(pool);
        lastScan = Date.now();
      }
      if (n === 0) await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error(`[worker] hata: ${(e as Error).message.slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await pool.end();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
console.log("[worker] VİADENT worker başladı (outbox + VİA Akış taraması)");
void loop();
