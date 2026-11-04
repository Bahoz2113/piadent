/**
 * PİA-DENT standart ürün listesi (ADR-097): diş kliniğinde hastada sık kullanılan sarf ve malzemeler — başlangıç listesi.
 * Marka/model içermez, fiyatsızdır; klinik "Standart listeyi ekle" ile yalnız eksik kodları alır, tedarikçi fiyatını kendisi girer.
 * Alanlar: kod, ad, birim (STOCK_UNITS), kategori, lot/SKT takibi.
 */
export type StandardProduct = { code: string; name: string; unit: "adet" | "kutu" | "paket" | "ml" | "g" | "set" | "kartus"; category: string; trackLots: boolean };
const p = (code: string, name: string, unit: StandardProduct["unit"], category: string, trackLots = false): StandardProduct => ({ code, name, unit, category, trackLots });

export const STANDARD_PRODUCTS: readonly StandardProduct[] = [
  // Koruyucu ve genel sarf
  p("STD-ELD", "Muayene eldiveni (nitril)", "kutu", "Genel sarf"),
  p("STD-MSK", "Cerrahi maske", "kutu", "Genel sarf"),
  p("STD-ONL", "Hasta önlüğü (tek kullanımlık)", "paket", "Genel sarf"),
  p("STD-TKZ", "Tükürük emici", "paket", "Genel sarf"),
  p("STD-PMK", "Pamuk rulo", "paket", "Genel sarf"),
  p("STD-GZB", "Gazlı bez (steril)", "paket", "Genel sarf"),
  p("STD-BRD", "Plastik bardak", "paket", "Genel sarf"),
  p("STD-STP", "Sterilizasyon poşeti", "paket", "Sterilizasyon"),
  p("STD-DZF", "Yüzey dezenfektanı", "ml", "Sterilizasyon"),
  // Anestezi
  p("STD-ANS", "Lokal anestezik kartuş", "kartus", "Anestezi", true),
  p("STD-IGN", "Dental enjektör iğnesi", "kutu", "Anestezi", true),
  p("STD-TOP", "Topikal anestezik jel", "g", "Anestezi", true),
  // Restoratif
  p("STD-KMP", "Kompozit dolgu materyali", "g", "Restoratif", true),
  p("STD-BND", "Bonding ajanı", "ml", "Restoratif", true),
  p("STD-ASD", "Asit jel (pürüzlendirme)", "ml", "Restoratif", true),
  p("STD-CIY", "Cam iyonomer siman", "g", "Restoratif", true),
  p("STD-GDL", "Geçici dolgu materyali", "g", "Restoratif", true),
  p("STD-MTR", "Matris bandı", "paket", "Restoratif"),
  p("STD-KMA", "Kama (wedge)", "paket", "Restoratif"),
  p("STD-PLS", "Polisaj diski / lastiği", "set", "Restoratif"),
  // Endodonti
  p("STD-EGE", "Kanal eğesi (döner alet)", "set", "Endodonti", true),
  p("STD-GUT", "Güta-perka kon", "kutu", "Endodonti", true),
  p("STD-PPR", "Paper point", "kutu", "Endodonti"),
  p("STD-PAT", "Kanal patı (siler)", "g", "Endodonti", true),
  p("STD-NAO", "Sodyum hipoklorit (irrigasyon)", "ml", "Endodonti", true),
  p("STD-RBD", "Rubber dam örtüsü", "paket", "Endodonti"),
  // Cerrahi ve implant
  p("STD-SUT", "Sütür (dikiş materyali)", "adet", "Cerrahi", true),
  p("STD-BST", "Bistüri ucu", "adet", "Cerrahi", true),
  p("STD-HMS", "Hemostatik sünger", "adet", "Cerrahi", true),
  p("STD-IMP", "İmplant fikstürü", "adet", "İmplant", true),
  p("STD-ABT", "İmplant abutmanı", "adet", "İmplant", true),
  p("STD-GRF", "Kemik grefti", "g", "İmplant", true),
  p("STD-MEM", "Bariyer membran", "adet", "İmplant", true),
  // Protez ve ölçü
  p("STD-OLC", "Ölçü materyali (silikon)", "ml", "Protez", true),
  p("STD-ALJ", "Aljinat ölçü maddesi", "g", "Protez", true),
  p("STD-KAS", "Ölçü kaşığı (tek kullanımlık)", "adet", "Protez"),
  p("STD-SMN", "Kalıcı siman (kron/köprü)", "g", "Protez", true),
  p("STD-GKR", "Geçici kron materyali", "g", "Protez", true),
  // Periodontoloji ve koruyucu
  p("STD-PRF", "Profilaksi patı", "g", "Koruyucu", true),
  p("STD-FLR", "Flor vernik", "ml", "Koruyucu", true),
  p("STD-FSR", "Fissür örtücü", "ml", "Koruyucu", true),
  p("STD-KLH", "Klorheksidin gargara", "ml", "Koruyucu", true),
  // Radyoloji
  p("STD-SNS", "Röntgen sensör kılıfı", "paket", "Radyoloji"),
];
