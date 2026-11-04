/**
 * PİA-DENT standart işlem listesi (ADR-094): diş kliniğinde sık yapılan işlemlerin klinik içi kodları.
 * Resmî bir kod sistemi (ör. meslek kuruluşu tarifesi) değildir; adlar genel tıbbi terimlerdir. Fiyatlar yalnız SENTETİK DEMO
 * içindir — gerçek klinik "Standart listeyi ekle" ile işlemleri fiyatsız alır ve tarifesini kendisi yayınlar.
 * Alanlar: kod, ad, kategori, kapsam (tooth | surface | quadrant | arch | mouth), varsayılan süre (dk), demo fiyat (TL).
 */
export type StandardProcedure = { code: string; name: string; category: string; toothScope: "tooth" | "surface" | "quadrant" | "arch" | "mouth"; minutes: number; demoPrice: string };

const row = (code: string, name: string, category: string, toothScope: StandardProcedure["toothScope"], minutes: number, demoPrice: string): StandardProcedure =>
  ({ code, name, category, toothScope, minutes, demoPrice });

export const STANDARD_PROCEDURES: readonly StandardProcedure[] = [
  // Muayene ve teşhis
  row("MUA-01", "Muayene ve tedavi planlama", "Muayene", "mouth", 20, "600.00"),
  row("MUA-02", "Kontrol muayenesi", "Muayene", "mouth", 15, "400.00"),
  row("MUA-03", "Acil muayene", "Muayene", "mouth", 20, "750.00"),
  row("MUA-04", "Uzman hekim konsültasyonu", "Muayene", "mouth", 20, "800.00"),
  // Radyoloji
  row("RAD-01", "Periapikal röntgen", "Radyoloji", "tooth", 10, "250.00"),
  row("RAD-02", "Panoramik röntgen", "Radyoloji", "mouth", 10, "600.00"),
  row("RAD-03", "Bite-wing röntgen", "Radyoloji", "quadrant", 10, "300.00"),
  row("RAD-04", "Konik ışınlı tomografi (CBCT)", "Radyoloji", "arch", 20, "2000.00"),
  // Koruyucu
  row("FLU-01", "Flor uygulaması (çene)", "Koruyucu", "arch", 15, "500.00"),
  row("FSR-01", "Fissür örtücü", "Koruyucu", "tooth", 15, "700.00"),
  row("KOR-01", "Ağız hijyeni eğitimi", "Koruyucu", "mouth", 15, "300.00"),
  // Periodontoloji
  row("TEM-01", "Diş taşı temizliği (tüm ağız)", "Periodontoloji", "mouth", 30, "1200.00"),
  row("PER-01", "Kök yüzeyi düzleştirme (bölge)", "Periodontoloji", "quadrant", 45, "1500.00"),
  row("PER-02", "Gingivektomi (bölge)", "Periodontoloji", "quadrant", 45, "2500.00"),
  row("PER-03", "Flep operasyonu (bölge)", "Periodontoloji", "quadrant", 60, "4000.00"),
  row("PRF-01", "Profesyonel polisaj", "Periodontoloji", "mouth", 20, "600.00"),
  // Restoratif
  row("DOL-01", "Kompozit dolgu (tek yüz)", "Restoratif", "surface", 30, "1800.00"),
  row("DOL-02", "Kompozit dolgu (iki yüz)", "Restoratif", "surface", 45, "2300.00"),
  row("DOL-03", "Kompozit dolgu (üç yüz)", "Restoratif", "surface", 60, "2800.00"),
  row("DOL-04", "Cam iyonomer dolgu", "Restoratif", "surface", 30, "1200.00"),
  row("DOL-05", "Geçici dolgu", "Restoratif", "tooth", 15, "500.00"),
  row("INL-01", "İnley / onley (seramik)", "Restoratif", "tooth", 60, "5500.00"),
  // Endodonti
  row("KAN-01", "Kanal tedavisi (tek kanal)", "Endodonti", "tooth", 60, "3500.00"),
  row("KAN-02", "Kanal tedavisi (iki kanal)", "Endodonti", "tooth", 75, "4500.00"),
  row("KAN-03", "Kanal tedavisi (üç kanal)", "Endodonti", "tooth", 90, "5500.00"),
  row("KAN-04", "Kanal tedavisi yenileme", "Endodonti", "tooth", 90, "6000.00"),
  row("KAN-05", "Kuafaj / pulpa örtüleme", "Endodonti", "tooth", 30, "1000.00"),
  // Cerrahi
  row("CEK-01", "Diş çekimi (basit)", "Cerrahi", "tooth", 30, "1500.00"),
  row("CEK-02", "Diş çekimi (cerrahi)", "Cerrahi", "tooth", 45, "3000.00"),
  row("CEK-03", "Gömülü yirmi yaş dişi çekimi", "Cerrahi", "tooth", 60, "5000.00"),
  row("CER-01", "Apikal rezeksiyon", "Cerrahi", "tooth", 60, "4500.00"),
  row("CER-02", "Kist operasyonu", "Cerrahi", "quadrant", 60, "5500.00"),
  // İmplantoloji
  row("IMP-01", "İmplant uygulaması", "İmplantoloji", "tooth", 60, "18000.00"),
  row("IMP-02", "İmplant üstü kron", "İmplantoloji", "tooth", 45, "9000.00"),
  row("IMP-03", "Kemik tozu / greft uygulaması", "İmplantoloji", "tooth", 45, "6000.00"),
  row("IMP-04", "Sinüs lifting", "İmplantoloji", "quadrant", 90, "15000.00"),
  // Protez
  row("KRN-01", "Zirkonyum kron", "Protez", "tooth", 45, "7500.00"),
  row("KRN-02", "Metal destekli porselen kron", "Protez", "tooth", 45, "5000.00"),
  row("KRN-03", "Geçici kron", "Protez", "tooth", 20, "1000.00"),
  row("LAM-01", "Laminate veneer", "Protez", "tooth", 60, "9000.00"),
  row("PRT-01", "Tam protez (çene)", "Protez", "arch", 60, "15000.00"),
  row("PRT-02", "Bölümlü protez (çene)", "Protez", "arch", 60, "12000.00"),
  row("PRT-03", "Protez tamiri", "Protez", "arch", 30, "1500.00"),
  row("PST-01", "Fiber post / kor yapımı", "Protez", "tooth", 30, "2000.00"),
  // Ortodonti
  row("ORT-01", "Ortodonti başlangıç (sabit tel)", "Ortodonti", "mouth", 60, "25000.00"),
  row("ORT-02", "Ortodonti aylık kontrol", "Ortodonti", "mouth", 20, "1200.00"),
  row("ORT-03", "Şeffaf plak tedavisi (başlangıç)", "Ortodonti", "mouth", 45, "45000.00"),
  row("ORT-04", "Pekiştirme apareyi", "Ortodonti", "arch", 30, "3500.00"),
  // Pedodonti
  row("PED-01", "Süt dişi dolgusu", "Pedodonti", "tooth", 30, "1200.00"),
  row("PED-02", "Süt dişi kanal tedavisi (amputasyon)", "Pedodonti", "tooth", 45, "2000.00"),
  row("PED-03", "Yer tutucu", "Pedodonti", "tooth", 30, "3000.00"),
  // Estetik
  row("BEY-01", "Diş beyazlatma (klinik)", "Estetik", "mouth", 60, "5000.00"),
  row("BEY-02", "Ev tipi beyazlatma plağı", "Estetik", "arch", 20, "3500.00"),
  // Diğer
  row("GEC-01", "Gece plağı", "Diğer", "arch", 20, "3000.00"),
  row("ANS-01", "Lokal anestezi (ek)", "Diğer", "tooth", 5, "250.00"),
];
