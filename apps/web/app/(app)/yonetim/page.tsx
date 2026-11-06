"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { EmptyState, useToast } from "@/components/ui";
import { TeamPanel } from "@/components/admin/team";
import { ResourcesPanel } from "@/components/admin/resources";
import { ProcedurePricesPanel } from "@/components/admin/agenda-settings";
import { CatalogPanel } from "@/components/admin/catalog";
import { TemplatesPanel } from "@/components/admin/templates";
import { IntegrationsPanel } from "@/components/admin/integrations";
import { ExportPanel, ImportPanel } from "@/components/admin/data-transfer";
import { SecurityPanel } from "@/components/admin/security";

const TABS = [
  { id: "ekip", label: "Ekip ve davet", perm: "team.manage" },
  { id: "kaynaklar", label: "Hekim ve koltuklar", perm: "schedule.manage" },
  { id: "turler", label: "İşlem türleri", perm: "treatment.read" },
  { id: "katalog", label: "Katalog ve tarife", perm: "catalog.manage" },
  { id: "belge", label: "Belge şablonları", perm: "template.manage" },
  { id: "kopru", label: "Entegrasyonlar (PİA Köprü)", perm: "integration.read" },
  { id: "aktarim", label: "Veri aktarımı", perm: "import.manage" },
  { id: "disa", label: "Dışa aktarım", perm: "export.clinic" },
  { id: "guvenlik", label: "Güvenlik", perm: "settings.manage" },
] as const;
/**
 * 07.11.2026 taşınan sekmeler (eski bağlantılar çalışsın): Kapatmalar → Hekimler (izin / rapor / resmî tatil),
 * Ürün ve fiyat listesi → Operasyon → Tedarikçi, Anamnez şablonu → kaldırıldı (sağlık özeti hasta kartında).
 */
const MOVED: Record<string, string> = { kapatma: "/hekimler", urunler: "/operasyon?sekme=tedarikci", anamnez: "/yonetim" };

export default function AdminPage() {
  const { can, session } = useSession();
  const tabs = TABS.filter((t) => can(t.perm));
  const [tab, setTab] = useState<string>(tabs[0]?.id ?? "");
  const router = useRouter();
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("sekme");
    if (want && MOVED[want]) { router.replace(MOVED[want]); return; }
    if (want && tabs.some((t) => t.id === want)) setTab(want);
  }, [tabs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const toast = useToast();
  return (
    <>
      <div className="page-head"><div><h1>Yönetim</h1><p>{session.activeMembership?.tenantName}</p></div></div>
      {tabs.length === 0 ? (
        <div className="card"><EmptyState title="Yönetim bölümü klinik yöneticilerine açıktır" /></div>
      ) : (
        <>
          <div className="subtabs" role="tablist" aria-label="Yönetim bölümleri">
            {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn btn-sm ${tab === t.id ? "btn-primary" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
          <div role="tabpanel">
            {tab === "ekip" && <TeamPanel notify={toast.show} />}
            {tab === "kaynaklar" && <ResourcesPanel notify={toast.show} />}
            {tab === "turler" && <ProcedurePricesPanel />}
            {tab === "katalog" && <CatalogPanel notify={toast.show} />}
            {tab === "belge" && <TemplatesPanel notify={toast.show} />}
            {tab === "kopru" && <IntegrationsPanel notify={toast.show} />}
            {tab === "aktarim" && <ImportPanel notify={toast.show} />}
            {tab === "disa" && <ExportPanel notify={toast.show} />}
            {tab === "guvenlik" && <SecurityPanel notify={toast.show} />}
          </div>
        </>
      )}
      {toast.node}
    </>
  );
}
