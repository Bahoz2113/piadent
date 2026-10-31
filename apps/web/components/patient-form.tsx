"use client";
import { DateField } from "@/components/ui";
import { useState } from "react";
import { GENDERS, GENDER_LABELS, NATIONAL_ID_LABELS, NATIONAL_ID_TYPES } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, todayIn } from "@/lib/format";
import { Alert, Drawer, SelectField, TextField } from "./ui";

export interface Candidate { id: string; fileNo: number; fullName: string; birthDate: string | null; phoneMasked: string | null; kind: string; reason: string }
export interface CreatedPatient { id: string; fullName: string; fileNo: number }

const EMPTY = { firstName: "", lastName: "", birthDate: "", gender: "", phone: "", email: "", nationalIdType: "", nationalId: "", city: "", primaryPractitionerId: "", referralSource: "" };

/** Yeni hasta: minimum kimlik/iletişim; mükerrer adaylar kayıttan önce gösterilir (Akış A). */
export function NewPatientDrawer({ onClose, onCreated, initialName }: { onClose: () => void; onCreated: (p: CreatedPatient) => void; initialName?: string }) {
  const { tz } = useSession();
  const [first, ...rest] = (initialName ?? "").trim().split(" ");
  const [f, setF] = useState({ ...EMPTY, firstName: first ?? "", lastName: rest.join(" ") });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const res = useData<{ practitioners: { id: string; name: string }[] }>("/resources");
  const dirty = Object.entries(f).some(([k, v]) => v !== (EMPTY as Record<string, string>)[k]);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  function payload(ack: boolean) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) if (v) out[k] = v;
    if (ack) out.acknowledgeDuplicates = true;
    return out;
  }

  async function save(ack = false) {
    if (busy) return;
    const local: Record<string, string> = {};
    if (!f.firstName.trim()) local.firstName = "Ad gerekli";
    if (!f.lastName.trim()) local.lastName = "Soyad gerekli";
    if (f.birthDate && f.birthDate > todayIn(tz)) local.birthDate = "Doğum tarihi gelecekte olamaz.";
    if (!!f.nationalId !== !!f.nationalIdType) local.nationalId = "Kimlik türü ve numarası birlikte girilmeli";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await api<{ patient: CreatedPatient }>("/patients", { body: payload(ack) });
      onCreated(r.patient);
    } catch (e) {
      const err = e as ApiFailure;
      if (err.code === "DUPLICATE_CANDIDATES" || err.code === "DUPLICATE_IDENTITY") {
        setCandidates((err.body.details as { candidates: Candidate[] }).candidates);
      }
      setErrors(err.fieldErrors);
      setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  const strong = candidates?.filter((c) => c.kind === "same_person_likely" || c.kind === "same_identity") ?? [];
  const identityBlock = candidates?.some((c) => c.kind === "same_identity");

  return (
    <Drawer title="Yeni hasta" subtitle="Yalnız gerekli bilgilerle başlayın; ayrıntılar sonra eklenebilir." onClose={onClose} dirty={dirty}
      footer={<>
        <button className="btn" onClick={onClose}>Vazgeç</button>
        {strong.length > 0 && !identityBlock ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => void save(true)}>Farklı kişi, yine de kaydet</button>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={() => void save(false)}>{busy ? "Kaydediliyor…" : "Hastayı kaydet"}</button>
        )}
      </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(false); }} noValidate>
        {failure && !candidates && <Alert kind="error">{failure.message}</Alert>}
        {strong.length > 0 && (
          <Alert kind="warning" title={identityBlock ? "Bu kimlik numarası kayıtlı" : "Aynı kişi olabilecek kayıt bulundu"}>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {strong.map((c) => (
                <li key={c.id}><a href={`/hastalar/${c.id}`} target="_blank" rel="noreferrer">{c.fullName}</a> · Dosya #{c.fileNo} · {fmtDate(c.birthDate)} — {c.reason}</li>
              ))}
            </ul>
            {!identityBlock && <p className="small" style={{ marginTop: 6 }}>Mevcut kaydı kullanın veya farklı kişi olduğunu doğrulayarak kaydedin.</p>}
          </Alert>
        )}
        <div className="form-grid">
          <TextField label="Ad" required value={f.firstName} onChange={set("firstName")} error={errors.firstName} autoComplete="off" />
          <TextField label="Soyad" required value={f.lastName} onChange={set("lastName")} error={errors.lastName} autoComplete="off" />
          <DateField label="Doğum tarihi" max={todayIn(tz)} value={f.birthDate} onChange={set("birthDate")} error={errors.birthDate} hint="Bilinmiyorsa boş bırakın." />
          <SelectField label="Cinsiyet" value={f.gender} onChange={set("gender")}>
            <option value="">Seçilmedi</option>
            {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
          </SelectField>
          <TextField label="Telefon" type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} error={errors.phone} hint="Aile bireyleri aynı numarayı kullanabilir." />
          <TextField label="E-posta" type="email" value={f.email} onChange={set("email")} error={errors.email} />
          <SelectField label="Kimlik belgesi türü" value={f.nationalIdType} onChange={set("nationalIdType")}>
            <option value="">Girilmedi</option>
            {NATIONAL_ID_TYPES.map((t) => <option key={t} value={t}>{NATIONAL_ID_LABELS[t]}</option>)}
          </SelectField>
          <TextField label="Kimlik / pasaport no" value={f.nationalId} onChange={set("nationalId")} error={errors.nationalId} autoComplete="off" />
          <SelectField label="Sorumlu hekim" value={f.primaryPractitionerId} onChange={set("primaryPractitionerId")}>
            <option value="">Seçilmedi</option>
            {res.data?.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
          <TextField label="Şehir" value={f.city} onChange={set("city")} />
          <TextField label="Nereden duydu?" className="full" value={f.referralSource} onChange={set("referralSource")} hint="Örn. tavsiye, internet araması" />
        </div>
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
