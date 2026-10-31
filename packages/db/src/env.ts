import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Kök .env dosyasını (varsa) yükler; mevcut ortam değişkenlerini ezmez. */
export function loadEnv(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trimStart().startsWith("#")) continue;
      const [, key, raw] = m;
      if (key && process.env[key] === undefined) process.env[key] = raw!.replace(/^"(.*)"$/, "$1");
    }
    return;
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Ortam değişkeni eksik: ${name} (.env.example dosyasına bakın)`);
  return v;
}
