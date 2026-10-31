// Serverless API paketi (Görev 15): apps/api + worker + db + contracts tek dosyada, TÜM bağımlılıklar gömülü (web'in node_modules'ında
// Nest/pg olmadığı için). Çıktı: apps/web/vendor/viadent-api.cjs — Next pages/api köprüsü çalışma zamanında require eder.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "apps/web/vendor"), { recursive: true });
// Migration SQL'leri pakete gömülür: serverless fonksiyonunda dosya sistemi yok (ENOENT), tracing globuna güvenilmez.
const migDirSrc = join(root, "packages/db/migrations");
const embedded = Object.fromEntries(readdirSync(migDirSrc).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => [f, readFileSync(join(migDirSrc, f), "utf8")]));
const entry = [
  `import { setMigrationSource } from ${JSON.stringify(join(root, "packages/db/src/index.ts"))};`,
  `import handler from ${JSON.stringify(join(root, "apps/api/src/serverless.ts"))};`,
  `setMigrationSource(${JSON.stringify(embedded)});`,
  "export default handler;",
].join("\n");

await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts", sourcefile: "serverless-entry.ts" }, outfile: join(root, "apps/web/vendor/viadent-api.cjs"),
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
console.log(`derlendi: apps/web/vendor/viadent-api.cjs (${Object.keys(embedded).length} migration gömülü, ${readdirSync(migDst).filter((f) => f.endsWith(".sql")).length} kopya)`);
