import { OPERATIONS, ProviderError, type Operation, type ProviderAdapter } from "./bridge.js";

/**
 * Sağlayıcı adaptörü SÖZLEŞME testi (Faz 3, ADR-086). Her adaptör (MOCK dahil; ileride gerçek sağlayıcılar) bu vakaları geçmelidir.
 * Test çerçevesinden bağımsız: her vaka { name, run } döner; run() başarısızlıkta Error fırlatır.
 * Kurallar: aynı idempotency anahtarı → aynı providerRef; reddin kodu ve mesajı var; zaman aşımı/erişilemezlik ProviderError ile;
 * desteklenmeyen işlem sessizce "kabul" edilmez; MOCK adaptör "MOCK" etiketlidir ve ağa çıkmaz.
 */
export interface ContractCase { name: string; run: () => Promise<void> }
const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error(`sözleşme ihlali: ${msg}`); };

export function adapterContractCases(make: (opts?: { behavior?: "accept" | "reject" | "timeout" | "unavailable"; queryResult?: "accepted" | "not_found" }) => ProviderAdapter): ContractCase[] {
  const supported = (a: ProviderAdapter) => OPERATIONS.filter((op) => a.supports(op));
  return [
    { name: "kimlik: id/label dolu; isMock ise etiket MOCK içerir", run: async () => {
      const a = make(); assert(a.id && a.label, "id/label boş");
      if (a.isMock) assert(/MOCK/.test(a.label), "mock adaptör etiketinde MOCK yok");
    } },
    { name: "en az bir işlem desteklenir; supports() OPERATIONS dışını kabul etmez", run: async () => {
      const a = make(); assert(supported(a).length > 0, "hiç işlem desteklenmiyor");
      assert(!a.supports("bilinmeyen.islem" as Operation), "bilinmeyen işlem desteklenir görünüyor");
    } },
    { name: "idempotency: aynı anahtar aynı providerRef, farklı anahtar farklı ref", run: async () => {
      const a = make(); const op = supported(a)[0]!;
      const r1 = await a.submit(op, {}, "k-1"); const r2 = await a.submit(op, {}, "k-1"); const r3 = await a.submit(op, {}, "k-2");
      const ref = (r: { outcome: string; providerRef?: string }) => (r.outcome === "accepted" ? r.providerRef : undefined);
      assert(ref(r1) && ref(r2) && ref(r3), "kabul beklendi");
      assert(ref(r1) === ref(r2), "aynı anahtar farklı referans");
      assert(ref(r1) !== ref(r3), "farklı anahtar aynı referans");
    } },
    { name: "ret: outcome=rejected, code ve message dolu", run: async () => {
      const a = make({ behavior: "reject" }); const r = await a.submit(supported(a)[0]!, {}, "k-r");
      assert(r.outcome === "rejected" && r.code && r.message, "ret biçimi hatalı");
    } },
    { name: "zaman aşımı ve erişilemezlik ProviderError(kind) fırlatır (sahte başarı yok)", run: async () => {
      for (const b of ["timeout", "unavailable"] as const) {
        const a = make({ behavior: b }); let err: unknown = null;
        try { await a.submit(supported(a)[0]!, {}, "k-t"); } catch (e) { err = e; }
        assert(err instanceof ProviderError && err.kind === b, `${b}: ProviderError(${b}) beklendi`);
      }
    } },
    { name: "durum sorgusu: kabul edilmiş anahtar aynı referansla döner; bilinmeyen anahtar not_found", run: async () => {
      const a = make(); const op = supported(a)[0]!; const s = await a.submit(op, {}, "k-q");
      const q = await a.query(op, "k-q");
      const ref = (r: { outcome: string; providerRef?: string }) => (r.outcome === "accepted" ? r.providerRef : undefined);
      assert(ref(q) && ref(q) === ref(s), "sorgu referansı farklı");
      const nf = await make({ queryResult: "not_found" }).query(op, "k-yok");
      assert(nf.outcome === "not_found", "not_found beklendi");
    } },
    { name: "desteklenmeyen işlem kabul edilmez (ret ya da hata)", run: async () => {
      const a = make(); const un = OPERATIONS.find((op) => !a.supports(op));
      if (!un) return; // hepsini destekliyor
      let r: unknown; try { r = await a.submit(un, {}, "k-u"); } catch (e) { r = e; }
      assert(!(typeof r === "object" && r && (r as { outcome?: string }).outcome === "accepted"), "desteklenmeyen işlem kabul edildi");
    } },
    { name: "e-belge: kabulde invoiceNo döner ve resmî seri gibi görünmez (MOCK ön eki) — yalnız einvoice.submit destekleniyorsa", run: async () => {
      const a = make(); if (!a.supports("einvoice.submit")) return;
      const r = await a.submit("einvoice.submit", {}, "k-inv");
      const no = r.outcome === "accepted" ? r.data?.invoiceNo : undefined;
      assert(no, "invoiceNo yok");
      if (a.isMock) assert(no!.startsWith("MOCK"), "mock fatura numarası MOCK ile başlamalı");
    } },
    { name: "MOCK adaptör ağa çıkmaz (fetch çağrısı yok)", run: async () => {
      const a = make(); if (!a.isMock) return;
      const g = globalThis as { fetch?: unknown }; const orig = g.fetch; let called = 0;
      g.fetch = async () => { called++; throw new Error("ağ yasak"); };
      try { for (const op of supported(a)) await a.submit(op, {}, `k-net-${op}`); } finally { g.fetch = orig; }
      assert(called === 0, "mock adaptör fetch çağırdı");
    } },
  ];
}
