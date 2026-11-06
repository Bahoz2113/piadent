/**
 * Netgsm SMS adaptörü (ADR-102, ürün sahibi kararı 07.11.2026 "Netgsm bağlansın").
 * Uç: POST https://api.netgsm.com.tr/sms/rest/v2/send — Basic yetkilendirme (kullanıcı kodu : API alt kullanıcı parolası),
 * gövde { msgheader, encoding: "TR", iysfilter: "0", messages: [{ msg, no }] }; başarı yanıtı code "00" + jobid.
 * Teslim raporu: POST /sms/rest/v2/report { jobids: [...] } → jobs[].status (1 = iletildi).
 *
 * Kimlik bilgileri YALNIZ ortam değişkeninden okunur (NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_MSGHEADER); veritabanına, loga, kanıta
 * yazılmaz. Gerçek gönderim ayrıca canlı gönderim kapısı ister (VIADENT_EXTERNAL_SEND_ENABLED=true). Bunlardan biri yoksa adaptör kurulmaz ve
 * sistem DENEME sağlayıcıya düşer; ekranda "gerçek mesaj gönderilmez" yazar (sahte başarı yok).
 * iysfilter "0": bilgilendirme (randevu hatırlatma, tedavi bilgisi) — ticari ileti değildir; kampanya mesajı için İYS onayı gerekir (kapsam dışı).
 */
import { ProviderError, type Operation, type ProviderAdapter, type SubmitResult } from "./bridge.js";

export interface NetgsmEnv { usercode: string; password: string; msgheader: string; appname?: string; baseUrl?: string }

export function netgsmEnv(env: NodeJS.ProcessEnv = process.env): NetgsmEnv | null {
  const usercode = env.NETGSM_USERCODE?.trim(), password = env.NETGSM_PASSWORD?.trim(), msgheader = env.NETGSM_MSGHEADER?.trim();
  if (!usercode || !password || !msgheader) return null;
  return { usercode, password, msgheader, appname: env.NETGSM_APPNAME?.trim() || "PIA-DENT", baseUrl: env.NETGSM_BASE_URL?.trim() || undefined };
}

/** Gerçek gönderime hazır mı? Ekran durumu ve sağlayıcı seçimi için; gizli değer döndürmez. */
export function netgsmStatus(env: NodeJS.ProcessEnv = process.env): { configured: boolean; gateOpen: boolean; ready: boolean; missing: string[]; sender: string | null } {
  const missing = [["NETGSM_USERCODE", "kullanıcı kodu"], ["NETGSM_PASSWORD", "API parolası"], ["NETGSM_MSGHEADER", "onaylı gönderen adı"]]
    .filter(([k]) => !env[k!]?.trim()).map(([, l]) => l!);
  const gateOpen = env.VIADENT_EXTERNAL_SEND_ENABLED === "true";
  if (!gateOpen) missing.push("canlı gönderim kapısı (VIADENT_EXTERNAL_SEND_ENABLED)");
  const configured = missing.filter((m) => !m.startsWith("canlı")).length === 0;
  return { configured, gateOpen, ready: configured && gateOpen, missing, sender: configured ? env.NETGSM_MSGHEADER!.trim() : null };
}

/** Netgsm gönderim yanıt kodları (resmî dokümandaki anlamlarıyla, Türkçe). */
const SEND_CODES: Record<string, string> = {
  "20": "Mesaj metni hatalı veya azami karakteri aşıyor",
  "30": "Geçersiz kullanıcı kodu/parola veya API erişim izni (IP kısıtı) yok",
  "40": "Gönderen adı (mesaj başlığı) sistemde tanımlı değil",
  "50": "Abone hesabıyla İYS kontrollü gönderim yapılamıyor",
  "51": "Hesapta İYS marka bilgisi yok",
  "70": "Hatalı sorgu: parametrelerden biri eksik veya hatalı",
  "80": "Gönderim sınırı aşıldı",
  "85": "Mükerrer gönderim sınırı aşıldı",
};
/** Teslim raporu durumları. */
export const NETGSM_REPORT_STATUS: Record<number, { status: "submitted" | "delivered" | "failed" | "unknown"; label: string }> = {
  0: { status: "submitted", label: "Operatörde, iletilmeyi bekliyor" },
  1: { status: "delivered", label: "İletildi" },
  2: { status: "failed", label: "Zaman aşımı; iletilemedi" },
  3: { status: "failed", label: "Hatalı veya kısıtlı numara" },
  4: { status: "failed", label: "Operatöre gönderilemedi" },
  11: { status: "failed", label: "Operatör kabul etmedi" },
  12: { status: "failed", label: "Gönderim hatası" },
  13: { status: "failed", label: "Mükerrer gönderim" },
  14: { status: "failed", label: "Yetersiz kredi" },
};

type Fetch = typeof fetch;

/** E.164 (+905xxxxxxxxx) → Netgsm biçimi (905xxxxxxxxx). */
export const netgsmNumber = (e164: string) => e164.replace(/[^\d]/g, "");

export class NetgsmSmsAdapter implements ProviderAdapter {
  readonly id = "netgsm";
  readonly label = "Netgsm SMS";
  readonly isMock = false;
  constructor(private readonly env: NetgsmEnv, private readonly http: Fetch = fetch, private readonly timeoutMs = 15_000) {}
  supports(op: Operation) { return op === "sms.send"; }
  private headers() {
    return { authorization: `Basic ${Buffer.from(`${this.env.usercode}:${this.env.password}`).toString("base64")}`, "content-type": "application/json" };
  }
  private async post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const r = await this.http(`${this.env.baseUrl ?? "https://api.netgsm.com.tr"}${path}`, { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: ac.signal });
      const text = await r.text();
      let json: Record<string, unknown> | null = null;
      try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
      return { status: r.status, json };
    } catch (e) {
      // İstek gitti mi bilinmez: zaman aşımı "belirsiz" sayılır (kör tekrar yok); bağlantı kurulamadıysa geçici hata.
      if ((e as Error).name === "AbortError") throw new ProviderError("timeout", "Netgsm yanıt vermedi (zaman aşımı)");
      throw new ProviderError("unavailable", "Netgsm'e bağlanılamadı");
    } finally { clearTimeout(t); }
  }
  async submit(op: Operation, payload: Record<string, unknown>): Promise<SubmitResult> {
    if (op !== "sms.send") return { outcome: "rejected", code: "UNSUPPORTED_OPERATION", message: `Netgsm bu işlemi desteklemiyor: ${op}` };
    const to = typeof payload.to === "string" ? netgsmNumber(payload.to) : "";
    const msg = typeof payload.body === "string" ? payload.body : "";
    if (!to || !msg) return { outcome: "rejected", code: "INVALID_PAYLOAD", message: "Alıcı veya mesaj metni eksik" };
    const r = await this.post("/sms/rest/v2/send", { msgheader: this.env.msgheader, encoding: "TR", iysfilter: "0", appname: this.env.appname, messages: [{ msg, no: to }] });
    if (r.status >= 500) throw new ProviderError("unavailable", `Netgsm geçici hata (HTTP ${r.status})`);
    const code = String(r.json?.code ?? "");
    if (code === "00" && r.json?.jobid) return { outcome: "accepted", providerRef: String(r.json.jobid) };
    if (!r.json) throw new ProviderError("unavailable", `Netgsm yanıtı okunamadı (HTTP ${r.status})`);
    return { outcome: "rejected", code: `NETGSM_${code || r.status}`, message: SEND_CODES[code] ?? `Netgsm isteği reddetti (kod ${code || r.status})` };
  }
  /**
   * Netgsm bizim tekilleştirme anahtarımızla sorgu sunmaz. Yanıtı alınamayan gönderimin akıbeti bilinemez: "gönderildi" de "başarısız" da denmez,
   * iş "sonuç bilinmiyor" olarak kalır (yeniden göndermek çift SMS riskidir).
   */
  async query(): Promise<never> {
    throw new ProviderError("timeout", "Netgsm'de anahtarla durum sorgusu yok; sonuç bilinmiyor (çift gönderim riski nedeniyle yeniden gönderilmez)");
  }
  /** Teslim raporu: jobid → durum. */
  async report(jobids: string[]): Promise<{ jobid: string; status: number; errorCode?: string }[]> {
    if (!jobids.length) return [];
    const r = await this.post("/sms/rest/v2/report", { jobids, appname: this.env.appname });
    const jobs = (r.json?.jobs ?? []) as { jobid: string | number; status: number; errorCode?: string }[];
    return Array.isArray(jobs) ? jobs.map((j) => ({ jobid: String(j.jobid), status: Number(j.status), errorCode: j.errorCode })) : [];
  }
}
