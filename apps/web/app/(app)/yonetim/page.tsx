"use client";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { EmptyState, useToast } from "@/components/ui";
import { TeamPanel } from "@/components/admin/team";
import { ResourcesPanel } from "@/components/admin/resources";
import { ClosuresPanel, TypesPanel } from "@/components/admin/agenda-settings";

const TABS = [
  { id: "ekip", label: "Ekip ve davet", perm: "team.manage" },
  { id: "kaynaklar", label: "Hekim ve koltuklar", perm: "schedule.manage" },
  { id: "turler", label: "İşlem türleri", perm: "schedule.manage" },
  { id: "kapatma", label: "Kapatmalar", perm: "schedule.manage" },
] as const;

export default function AdminPage() {
  const { can, session } = useSession();
  const tabs = TABS.filter((t) => can(t.perm));
  const [tab, setTab] = useState<string>(tabs[0]?.id ?? "");
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
            {tab === "turler" && <TypesPanel notify={toast.show} />}
            {tab === "kapatma" && <ClosuresPanel notify={toast.show} />}
          </div>
        </>
      )}
      {toast.node}
    </>
  );
}
