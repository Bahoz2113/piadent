// Üretim derlemesi (Görev 8): API, worker ve veritabanı CLI'lerini tek dosyalık ESM paketlerine derler.
// Çalışma zamanında tsx/TypeScript gerekmez: `node apps/api/dist/main.js`.
// Çalışma alanı paketleri (@viadent/*) pakete gömülür; npm bağımlılıkları dışarıda kalır (prod node_modules'tan yüklenir).
import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Dışarıda bırakılan = yalnız hedef paketin KENDİ dependencies listesi (üretim imajında `pnpm deploy` ile kurulu olanlar).
// Çalışma alanı paketleri ve onların dolaylı bağımlılıkları (ör. db → contracts → zod) pakete gömülür; aksi halde
// imajda “Cannot find package” hatası olurdu (yerelde pnpm kaldırması bunu gizler).
const pkgName = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
function externalFor(pkgDir) {
  const deps = Object.keys(JSON.parse(readFileSync(join(root, pkgDir, "package.json"), "utf8")).dependencies ?? {}).filter((d) => !d.startsWith("@viadent/"));
  return {
    name: "dis-bagimliliklar",
    setup(b) {
      b.onResolve({ filter: /^[^./]/ }, (a) => {
        if (a.path.startsWith("node:")) return { path: a.path, external: true };
        return deps.includes(pkgName(a.path)) ? { path: a.path, external: true } : undefined;
      });
    },
  };
}
const common = {
  bundle: true, platform: "node", target: "node22", format: "esm", sourcemap: true, logLevel: "warning",
  tsconfig: join(root, "tsconfig.base.json"), legalComments: "none",
  external: ["pg-native"], // pg'nin isteğe bağlı yerel sürücüsü kullanılmıyor
  // ESM pakette CommonJS bağımlılıkları için require (ör. dinamik require kullanan kütüphaneler)
  banner: { js: "import { createRequire as __vdCreateRequire } from 'node:module'; const require = __vdCreateRequire(import.meta.url);" },
};
const targets = [
  { pkg: "apps/api", out: "apps/api/dist", entries: { main: "apps/api/src/main.ts" } },
  { pkg: "apps/worker", out: "apps/worker/dist", entries: { main: "apps/worker/src/main.ts" } },
  { pkg: "packages/db", out: "packages/db/dist", entries: { migrate: "packages/db/src/migrate.ts", roles: "packages/db/src/roles.ts", "backup-cli": "packages/db/src/backup-cli.ts", "rotate-keys": "packages/db/src/rotate-keys.ts", "encrypt-ids": "packages/db/src/encrypt-ids.ts" } },
];
for (const t of targets) {
  rmSync(join(root, t.out), { recursive: true, force: true });
  await build({ ...common, plugins: [externalFor(t.pkg)], outdir: join(root, t.out), entryPoints: Object.fromEntries(Object.entries(t.entries).map(([k, v]) => [k, join(root, v)])) });
  console.log(`derlendi: ${t.out} (${Object.keys(t.entries).join(", ")})`);
}
