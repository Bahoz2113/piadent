"use client";
import Link from "next/link";
import { BrandLogo } from "./brand";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3, BriefcaseMedical, Building2, CalendarDays, ChevronsLeft, ClipboardList, LayoutDashboard, LogOut, Menu, Palette, Search, Settings2, Stethoscope, Users, Wallet, RefreshCw, UserCog, MessageSquare,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { AppearanceDrawer } from "@/components/appearance-drawer";
import { TableLabels } from "@/components/table-labels";
import { DialogHost } from "@/components/dialogs";

const NAV = [
  { href: "/bugun", label: "Panel", icon: LayoutDashboard },
  { href: "/hastalar", label: "Hastalar", icon: Users },
  { href: "/ajanda", label: "Randevular", icon: CalendarDays },
  { href: "/hekimler", label: "Hekimler", icon: BriefcaseMedical },
  { href: "/tedavi", label: "Tedavi", icon: Stethoscope },
  { href: "/finans", label: "Finans", icon: Wallet },
  { href: "/operasyon", label: "Operasyon", icon: ClipboardList },
  { href: "/raporlar", label: "Raporlar", icon: BarChart3 },
  { href: "/mesajlar", label: "Mesajlar", icon: MessageSquare },
  { href: "/yonetim", label: "Yönetim", icon: Settings2 },
];

export function Shell({ children }: { children: ReactNode }) {
  const { session, switchTo, logout, contextChanged } = useSession();
  const path = usePathname() ?? "/";
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => setNavOpen(false), [path]);
  const active = session.activeMembership;

  return (
    <div className={`shell ${navOpen ? "nav-open" : ""} ${collapsed ? "collapsed" : ""}`}>
      <a href="#icerik" className="skip-link">İçeriğe geç</a>
      <nav className="sidenav" aria-label="Ana gezinme">
        <BrandLogo tagline="Kliniğin akışı, tek yerde." />
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="navlink" aria-current={path.startsWith(href) ? "page" : undefined} title={label}>
            <Icon size={19} aria-hidden /><span>{label}</span>
          </Link>
        ))}
        <button className="navlink desktop-only" style={{ background: "none", border: 0, cursor: "pointer", marginTop: 8 }} onClick={() => setCollapsed((c) => !c)} aria-pressed={collapsed}>
          <ChevronsLeft size={19} aria-hidden style={{ transform: collapsed ? "rotate(180deg)" : undefined }} /><span>Menüyü daralt</span>
        </button>
        <div className="nav-account mobile-only" aria-label="Hesap">
          <strong>{session.user.fullName}</strong>
          <span>{active?.roleLabel} · {active?.tenantName}</span>
          {session.memberships.length > 1 && (
            <label style={{ display: "block", marginTop: 8 }}>
              <span className="sr-only">Klinik değiştir</span>
              <select className="select" value={active?.id} onChange={(e) => void switchTo(e.target.value)} aria-label="Klinik değiştir">
                {session.memberships.map((m) => <option key={m.id} value={m.id}>{m.tenantName} — {m.roleLabel}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="nav-foot brand-text">Demo ortamı · yalnız sentetik veri</div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost icon-btn mobile-only" aria-label="Menüyü aç" onClick={() => setNavOpen(true)}><Menu size={20} /></button>
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); router.push(`/hastalar?q=${encodeURIComponent(q)}`); }}>
            <Search size={17} aria-hidden />
            <label htmlFor="global-search" className="sr-only">Hasta ara</label>
            <input id="global-search" className="input" placeholder="Hasta ara: ad, telefon, dosya no" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <div className="grow" />
          {session.memberships.length > 1 ? (
            <label className="row small desktop-only" style={{ gap: 6 }}>
              <Building2 size={17} aria-hidden />
              <span className="sr-only">Klinik</span>
              <select className="select" style={{ minHeight: 38, width: 260 }} value={active?.id} onChange={(e) => void switchTo(e.target.value)}>
                {session.memberships.map((m) => <option key={m.id} value={m.id}>{m.tenantName} — {m.roleLabel}</option>)}
              </select>
            </label>
          ) : (
            <span className="row small desktop-only muted"><Building2 size={17} aria-hidden />{active?.tenantName}</span>
          )}
          <Link href="/hesabim" className="row small desktop-only" style={{ gap: 4, flexDirection: "column", alignItems: "flex-end", color: "inherit", textDecoration: "none" }} title="Hesabım ve güvenlik">
            <strong>{session.user.fullName}</strong>
            <span className="muted">{active?.roleLabel}</span>
          </Link>
          <Link href="/hesabim" className="btn btn-ghost icon-btn mobile-only" aria-label="Hesabım ve güvenlik" title="Hesabım"><UserCog size={19} /></Link>
          <button className="btn btn-ghost icon-btn" onClick={() => setAppearanceOpen(true)} aria-label="Görünüm" title="Görünüm: renk, şema, ölçek"><Palette size={19} /></button>
          <button className="btn btn-ghost icon-btn" onClick={() => void logout()} aria-label="Çıkış yap" title="Çıkış yap"><LogOut size={19} /></button>
        </header>
        {appearanceOpen && <AppearanceDrawer onClose={() => setAppearanceOpen(false)} />}
        <TableLabels />
        <DialogHost />
        {contextChanged && (
          <div className="alert alert-warning" role="alert" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
            <RefreshCw size={18} aria-hidden />
            <div>
              <strong>Klinik bağlamı değişti veya erişiminiz güncellendi.</strong> Bu sekmedeki bilgiler güncel olmayabilir; işlem yapmadan önce sayfayı yenileyin.
              <div style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => window.location.reload()}>Sayfayı yenile</button></div>
            </div>
          </div>
        )}
        <main id="icerik" className="content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
