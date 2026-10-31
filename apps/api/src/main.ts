import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap.js";
import { loadConfig } from "./config.js";

const log = new Logger("viadent");
const config = loadConfig();
const app = await createApp(config);
// Süreç düzeyi koruma (QA-006): dinleyicisiz hata/ret süreci çökertmesin. Yalnız hata türü ve kırpılmış mesaj loglanır
// (istek gövdesi, parametre, kişisel veri yok). Bağlantı hataları havuzda zaten dinleniyor; buraya düşen beklenmedik istisnada
// yeni bağlantı kabulü durdurulur, açık istekler bitirilir ve süreç kontrollü kapanır (süreç yöneticisi yeniden başlatır).
const brief = (e: unknown) => `${(e as Error)?.name ?? ""} ${(e as { code?: string })?.code ?? ""} ${String((e as Error)?.message ?? e).slice(0, 200)}`.trim();
process.on("unhandledRejection", (e) => log.error(`işlenmemiş ret: ${brief(e)}`));
let closing = false;
process.on("uncaughtException", (e) => {
  log.error(`yakalanmamış istisna: ${brief(e)}`);
  if (closing) return;
  closing = true;
  setTimeout(() => process.exit(1), 10_000).unref();
  void app.close().then(() => process.exit(1), () => process.exit(1));
});
await app.listen(config.port, "127.0.0.1");
log.log(`VİADENT API http://127.0.0.1:${config.port}/api/v1`);
