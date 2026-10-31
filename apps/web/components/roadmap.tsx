import { Hammer } from "lucide-react";

/** Henüz geliştirilmemiş modül: boş "hazır" ekran yerine gerçek yol haritası durumu gösterilir (Plan §09). */
export function Roadmap({ title, module, task, items }: { title: string; module: string; task: string; items: string[] }) {
  return (
    <>
      <div className="page-head"><div><h1>{title}</h1><p>{module} · Durum: <strong>geliştirilmedi</strong></p></div></div>
      <section className="card card-pad stack">
        <div className="row"><Hammer size={20} aria-hidden color="var(--brand-accent)" /><h2>Bu modül henüz kullanıma açık değil</h2></div>
        <p className="muted">Sahte veya örnek rakamla dolu ekran gösterilmez. Planlanan ilk kapsam ({task}):</p>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>{items.map((i) => <li key={i}>{i}</li>)}</ul>
      </section>
    </>
  );
}
