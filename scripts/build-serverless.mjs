// Serverless API paketi (Görev 15): apps/api + worker + db + contracts tek dosyada, TÜM bağımlılıklar gömülü (web'in node_modules'ında
// Nest/pg olmadığı için). Çıktı: apps/web/vendor/viadent-api.cjs — Next pages/api köprüsü çalışma zamanında require eder.
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "apps/web/vendor"), { recursive: true });
await build({
  entryPoints: [join(root, "apps/api/src/serverless.ts")], outfile: join(root, "apps/web/vendor/viadent-api.cjs"),
  bundle: true, platform: "node", target: "node22", format: "cjs", sourcemap: false, logLevel: "warning", legalComments: "none",
  tsconfig: join(root, "tsconfig.base.json"),
  // Nest'in isteğe bağlı/eklenti paketleri kullanılmıyor; pg-native yok.
  external: ["pg-native", "@nestjs/microservices", "@nestjs/websockets", "@nestjs/platform-socket.io", "class-transformer", "class-validator", "@fastify/*", "cache-manager"],
  define: { "process.env.VIADENT_SERVERLESS": '"1"' },
});
// Migration SQL dosyaları: pakete gömülemez (diskten okunur), fonksiyon paketine kopyalanır.
const migSrc = join(root, "packages/db/migrations"), migDst = join(root, "apps/web/vendor/migrations");
mkdirSync(migDst, { recursive: true });
cpSync(migSrc, migDst, { recursive: true });
console.log(`derlendi: apps/web/vendor/viadent-api.cjs (+ ${readdirSync(migDst).filter((f) => f.endsWith(".sql")).length} migration)`);
