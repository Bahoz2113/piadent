import pg from "pg";
import { guardPool, loadEnv } from "@viadent/db";
import { processIntegrationJobs } from "@viadent/db";
import { processOutbox, scanAllTenants } from "./jobs.js";

loadEnv();
const url = process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("WORKER_DATABASE_URL tanımlı değil (.env.example)");
const pool = new pg.Pool({ connectionString: url, max: 4, application_name: "viadent-worker" });
// DB bağlantıyı kapatırsa (yeniden başlatma, failover) süreç çökmez: boştaki ve kullanımdaki istemciye dinleyici (QA-006); havuz yeni bağlantı açar.
guardPool(pool, "worker");
// Dinleyicisiz hata/ret süreci düşürmesin: kırpılmış mesaj loglanır (parametre/kişisel veri yok), döngü sürer.
process.on("unhandledRejection", (e) => console.error(`[worker] işlenmemiş ret: ${String((e as Error)?.message ?? e).slice(0, 200)}`));
process.on("uncaughtException", (e) => console.error(`[worker] yakalanmamış istisna: ${(e as Error)?.name ?? ""} ${String((e as Error)?.message ?? e).slice(0, 200)}`));
let stopping = false;
let lastScan = 0;

async function loop() {
  while (!stopping) {
    try {
      const n = (await processOutbox(pool)) + (await processIntegrationJobs(pool));
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
console.log("[worker] VİADENT worker başladı (outbox + VİA Köprü dış işleri + VİA Akış taraması)");
void loop();
