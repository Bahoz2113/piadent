/**
 * PİA-DENT standart belge türleri ve DEMO şablon gövdeleri.
 *
 * Buradaki tüm metinler PİA-DENT için sıfırdan yazılmış ÖZGÜN örnek (DEMO) metinlerdir. Rakip ürün formları yalnızca
 * "hangi belge türlerine ihtiyaç var" sorusunun yanıtı (başlık listesi) olarak kullanılmıştır; hiçbir rakip formun,
 * yayımlanmış hastane / dernek onam formunun ya da telif kapsamındaki bir metnin içeriği kopyalanmamış veya
 * yeniden ifade edilmemiştir. Klinik bilgiler genel ve yaygın bilinen olgulardır; ilaç dozu, başarı oranı ya da sonuç
 * sözü içermez.
 *
 * Her gövde "PİA-DENT ÖRNEK METİN (DEMO)" satırıyla başlar. Klinik, bu metinleri gerçek hastalarda kullanmadan önce
 * sorumlu hekimi ve hukuk danışmanıyla gözden geçirmeli, gerekirse tamamen değiştirmelidir. Bu metinler herhangi bir
 * mevzuata uygunluk iddiası taşımaz.
 *
 * Yalnızca şu alanlar kullanılır: {{hasta.ad_soyad}}, {{hasta.dosya_no}}, {{hasta.dogum_tarihi}}, {{klinik.ad}},
 * {{hekim.ad}}, {{belge.tarih}}, {{plan.kalemler}}.
 */
import type { DocumentCategory } from "./documents";

export type StandardDocumentType = {
  code: string;
  name: string;
  category: DocumentCategory;
  requiresAcceptance: boolean;
  issuerRole: "dentist" | null;
  /** Örn. "Diş çekimi bilgilendirme ve onam — PİA-DENT DEMO"; klinik çıktı türlerinde null. */
  templateName: string | null;
};

const t = (code: string, name: string, category: DocumentCategory, requiresAcceptance: boolean, issuerRole: "dentist" | null = null): StandardDocumentType =>
  ({ code, name, category, requiresAcceptance, issuerRole, templateName: category === "clinical_output" ? null : name + " — PİA-DENT DEMO" });

export const STANDARD_DOCUMENT_TYPES: readonly StandardDocumentType[] = [
  // Mevcut kodlar
  t("GENEL-ONAM", "Genel tedavi bilgilendirme ve onam", "consent", true),
  t("CERRAHI-ONAM", "Cerrahi işlem bilgilendirme ve onam", "consent", true),
  t("ENDO-ONAM", "Kanal tedavisi bilgilendirme ve onam", "consent", true),
  t("RESTORATIF-ONAM", "Restoratif ve estetik işlem bilgilendirme ve onam", "consent", true),
  t("PROTEZ-ONAM", "Protez işlemleri bilgilendirme ve onam", "consent", true),
  t("IMPLANT-ONAM", "İmplant tedavisi bilgilendirme ve onam", "consent", true),
  t("PERIO-ONAM", "Periodontal tedavi bilgilendirme ve onam", "consent", true),
  t("ORTO-ONAM", "Ortodontik tedavi bilgilendirme ve onam", "consent", true),
  t("PEDO-ONAM", "Çocuk hasta (veli/vasi) bilgilendirme ve onam", "consent", true),
  t("TRAVMA-ONAM", "Acil / travma tedavisi bilgilendirme ve onam", "consent", true),
  t("OZEL-ISLEM-ONAM", "İşleme özgü bilgilendirme ve onam (diğer)", "consent", true),
  t("ISLEM-SONRASI", "İşlem sonrası bakım ve kullanım bilgilendirmesi", "information", false),
  t("KVKK-AYDINLATMA", "Kişisel verilerin işlenmesine ilişkin aydınlatma", "privacy", false),
  t("GORSEL-IZIN", "Görsel kayıt ve kullanım izni", "privacy", true),
  t("HASTA-BILGI", "Hasta bilgi formu", "administrative", false),
  t("ISTIRAHAT", "İstirahat / durum belgesi", "administrative", false, "dentist"),
  t("SIGORTA-BILGI", "Özel sağlık sigortası bilgi formu", "insurance", false),
  // Yeni kodlar
  t("CEKIM-ONAM", "Diş çekimi bilgilendirme ve onam", "consent", true),
  t("GOMULU-CEKIM-ONAM", "Gömülü diş cerrahisi bilgilendirme ve onam", "consent", true),
  t("DOLGU-ONAM", "Dolgu tedavisi bilgilendirme ve onam", "consent", true),
  t("ENDO-TEKRAR-ONAM", "Kanal tedavisi yenileme bilgilendirme ve onam", "consent", true),
  t("BEYAZLATMA-ONAM", "Diş beyazlatma bilgilendirme ve onam", "consent", true),
  t("KRON-KOPRU-ONAM", "Kron ve köprü bilgilendirme ve onam", "consent", true),
  t("TAM-PROTEZ-ONAM", "Tam ve bölümlü hareketli protez bilgilendirme ve onam", "consent", true),
  t("IMPLANT-USTU-ONAM", "İmplant üstü protez bilgilendirme ve onam", "consent", true),
  t("SINUS-LIFT-ONAM", "Sinüs tabanı yükseltme ve kemik grefti bilgilendirme ve onam", "consent", true),
  t("PERIO-BASLANGIC-ONAM", "Diş taşı temizliği ve kök yüzeyi düzleştirme bilgilendirme ve onam", "consent", true),
  t("PERIO-CERRAHI-ONAM", "Periodontal cerrahi (flep) bilgilendirme ve onam", "consent", true),
  t("DISETI-GREFT-ONAM", "Diş eti grefti bilgilendirme ve onam", "consent", true),
  t("KRON-BOYU-ONAM", "Kron boyu uzatma bilgilendirme ve onam", "consent", true),
  t("FRENEKTOMI-ONAM", "Frenektomi bilgilendirme ve onam", "consent", true),
  t("APIKAL-REZ-ONAM", "Apikal rezeksiyon bilgilendirme ve onam", "consent", true),
  t("KIST-ONAM", "Kist ve lezyon cerrahisi bilgilendirme ve onam", "consent", true),
  t("BIYOPSI-ONAM", "Biyopsi ve patoloji incelemesi bilgilendirme ve onam", "consent", true),
  t("SEFFAF-PLAK-ONAM", "Şeffaf plak tedavisi bilgilendirme ve onam", "consent", true),
  t("ORTO-SONU-BILGI", "Ortodontik tedavi sonu ve pekiştirme bilgilendirmesi", "information", false),
  t("IMPLANT-SONRASI-BILGI", "İmplant sonrası bakım bilgilendirmesi", "information", false),
  t("PROTEZ-TESLIM-BILGI", "Protez teslimi ve yapıştırma bilgilendirmesi", "information", false),
  t("CEKIM-SONRASI-BILGI", "Çekim ve cerrahi sonrası bakım bilgilendirmesi", "information", false),
  // Klinik çıktılar (şablonları ayrı üretilir)
  t("EPIKRIZ", "Epikriz / tedavi özeti", "clinical_output", false, "dentist"),
  t("HASTA-FOYU", "Hasta bilgi föyü (klinik)", "clinical_output", false, "dentist"),
  t("RECETE", "Reçete yazısı (e-reçete değildir)", "clinical_output", false, "dentist"),
];

// ------------------------------------------------------------------ yapı taşları

const DEMO_LINE = "PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.";

const bullets = (items: readonly string[]): string[] => items.map((i) => "- " + i);

const header = (title: string): string[] => [
  DEMO_LINE,
  "",
  "{{klinik.ad}}",
  title,
  "Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}",
  "Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}",
];

const section = (heading: string, lines: readonly string[]): string[] => ["", heading, ...lines];

const PATIENT_STATEMENT: readonly string[] = [
  "Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.",
  "Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.",
  "İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.",
  "Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.",
  "Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.",
  "Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.",
];

const SIGNATURE: readonly string[] = [
  "Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________",
  "(Yasal temsilci ise yakınlığı: ______________)",
  "Hekim: {{hekim.ad}}   İmza: __________",
  "Tarih: {{belge.tarih}}",
];

type ConsentSpec = {
  title: string;
  definition: readonly string[];
  benefits: readonly string[];
  risks: readonly string[];
  alternatives: readonly string[];
  aftercare: readonly string[];
  /** Plan bölümünden önce ek bölüm(ler) (ör. hekimin dolduracağı açıklama satırları). */
  extra?: readonly { heading: string; lines: readonly string[] }[];
  statement?: readonly string[];
  signature?: readonly string[];
};

const consent = (s: ConsentSpec): string =>
  [
    ...header(s.title),
    ...section("İŞLEMİN TANIMI VE AMACI", s.definition),
    ...(s.extra ?? []).flatMap((e) => section(e.heading, e.lines)),
    ...section("PLANLANAN İŞLEMLER", ["{{plan.kalemler}}", "Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____", "______________________________________________"]),
    ...section("BEKLENEN YARARLAR", bullets(s.benefits)),
    ...section("OLASI RİSKLER VE YAN ETKİLER", bullets(s.risks)),
    ...section("ALTERNATİFLER VE TEDAVİ YAPILMAZSA", bullets(s.alternatives)),
    ...section("İŞLEM SONRASI DİKKAT EDİLECEKLER", bullets(s.aftercare)),
    ...section("HASTANIN BEYANI", bullets(s.statement ?? PATIENT_STATEMENT)),
    "",
    ...(s.signature ?? SIGNATURE),
  ].join("\n");

type InfoSpec = { title: string; sections: readonly { heading: string; lines: readonly string[] }[] };

const information = (s: InfoSpec): string =>
  [
    ...header(s.title),
    ...s.sections.flatMap((x) => section(x.heading, x.lines)),
    "",
    "Bu bilgilendirme {{belge.tarih}} tarihinde hastaya verilmiştir.",
    "",
    "Bilgilendirmeyi aldım. Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________",
    "Bilgilendiren hekim: {{hekim.ad}}   İmza: __________",
  ].join("\n");

const CALL_CLINIC_COMMON: readonly string[] = [
  "Kanama, baskı uygulamanıza rağmen durmuyorsa",
  "Şişlik veya ağrı günler geçtikçe azalmak yerine artıyorsa",
  "Ateş, halsizlik ya da ağızda kötü tat ve koku oluşursa",
  "Yutma veya nefes almada güçlük hissederseniz (bu durumda en yakın acil servise de başvurun)",
];

// ------------------------------------------------------------------ şablon gövdeleri

const BODIES: Record<string, string> = {
  "GENEL-ONAM": consent({
    title: "GENEL TEDAVİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Bu form; muayene, ağız içi ve röntgen görüntüleme, diş taşı temizliği, lokal anestezi (bölgesel uyuşturma) ve temel diş tedavileri için genel bilgi verir.",
      "Cerrahi, implant, kanal tedavisi gibi daha kapsamlı işlemler için ayrıca işleme özgü bir onam formu istenebilir.",
    ],
    benefits: [
      "Ağız ve diş sağlığınızın bütün olarak değerlendirilmesi",
      "Çürük, diş eti hastalığı gibi sorunların erken fark edilmesi",
      "Ağrı ve enfeksiyonun azaltılması, çiğneme ve konuşmanın korunması",
    ],
    risks: [
      "Uyuşturma sonrası birkaç saat süren his kaybı; enjeksiyon yerinde hassasiyet veya morarma",
      "Nadiren uyuşturucu maddeye karşı alerjik tepki",
      "Tedavi edilen dişlerde geçici sıcak-soğuk hassasiyeti",
      "Ağzın uzun süre açık kalmasına bağlı çene yorgunluğu veya dudak köşesinde çatlama",
      "Nadiren kullanılan aletlere bağlı dudak, yanak veya dilde küçük yaralanmalar",
    ],
    alternatives: [
      "Tedaviyi ertelemek, farklı bir tedavi seçeneğini tercih etmek veya başka bir hekimden görüş almak",
      "Tedavi yapılmazsa çürük ve diş eti hastalığı ilerleyebilir; ağrı, enfeksiyon ve diş kaybı gelişebilir",
    ],
    aftercare: [
      "Uyuşukluk geçene kadar yemek yemeyin, sıcak içeceklerden kaçının; dudak ve yanağınızı ısırmamaya dikkat edin",
      "Size verilen bakım önerilerine ve kontrol randevularına uyun",
      "Beklenmedik ağrı, şişlik veya kanama olursa kliniği arayın",
    ],
  }),

  "CERRAHI-ONAM": consent({
    title: "CERRAHİ İŞLEM BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Ağız içinde diş eti, kemik veya yumuşak dokuya yapılan cerrahi işlemler bu formun kapsamındadır. İşlem genellikle lokal anestezi altında yapılır.",
      "Hangi bölgede, hangi amaçla işlem yapılacağı aşağıdaki planda ve hekiminizin anlatımında belirtilmiştir.",
    ],
    benefits: [
      "Ağrı, enfeksiyon veya hastalığa yol açan nedenin ortadan kaldırılması",
      "Sonraki tedaviler (protez, implant vb.) için uygun ortamın hazırlanması",
    ],
    risks: [
      "İşlem sonrası ağrı, şişlik, morarma ve birkaç gün süren hassasiyet",
      "Kanama; nadiren tekrar müdahale gerektiren kanama",
      "Yara yerinde enfeksiyon veya yaranın geç iyileşmesi",
      "Bölgeye yakın sinirlerin etkilenmesine bağlı dudak, dil veya çenede geçici, çok nadiren kalıcı uyuşukluk",
      "Ağız açmada geçici kısıtlılık, komşu dişlerde veya dolgularda hasar",
      "Üst çene arka bölgede ağız ile sinüs arasında bağlantı oluşması",
    ],
    alternatives: [
      "Uygunsa cerrahi olmayan tedaviler, izleme veya başka bir uzmana yönlendirme",
      "İşlem yapılmazsa mevcut sorun ilerleyebilir, ağrı ve enfeksiyon tekrarlayabilir",
    ],
    aftercare: [
      "Hekimin verdiği tampon, soğuk uygulama ve beslenme önerilerine uyun",
      "İlk gün sert çalkalama yapmayın, sigara ve alkolden uzak durun",
      "İlaçları yalnızca hekiminizin önerdiği şekilde kullanın",
      "Kanama durmazsa, şişlik artarsa veya ateş olursa kliniği arayın",
    ],
  }),

  "CEKIM-ONAM": consent({
    title: "DİŞ ÇEKİMİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Diş çekimi, tedavi ile korunamayan, ağrı veya enfeksiyon kaynağı olan ya da tedavi planı gereği alınması gereken bir dişin lokal anestezi altında yuvasından çıkarılmasıdır.",
      "Kökleri eğri veya kırılgan dişlerde dişin parçalara ayrılarak çıkarılması ve yaranın dikişle kapatılması gerekebilir.",
    ],
    benefits: [
      "Ağrı ve enfeksiyon kaynağının ortadan kaldırılması",
      "Çevre dişlerin ve kemiğin daha fazla zarar görmesinin önlenmesi",
      "Protez, implant veya ortodontik tedavi için yer açılması",
    ],
    risks: [
      "Birkaç gün süren ağrı, şişlik ve morarma",
      "Kanama; kan sulandırıcı ilaç kullananlarda kanama eğilimi artabilir",
      "Çekim boşluğunda pıhtının erken kaybı ve buna bağlı şiddetli ağrı (kuru soket)",
      "Kök ucunun kırılması ve bazen bırakılması veya ek işlemle alınması",
      "Komşu diş veya dolgu ve kaplamalarda hasar",
      "Alt çenede sinire yakın dişlerde geçici, çok nadiren kalıcı uyuşukluk",
      "Üst çene arka dişlerinde ağız ile sinüs arasında bağlantı oluşması",
    ],
    alternatives: [
      "Uygunsa kanal tedavisi, dolgu, kaplama veya diş eti tedavisi ile dişin korunmaya çalışılması",
      "Çekim yapılmazsa ağrı ve enfeksiyon sürebilir, iltihap çevre dokulara yayılabilir",
      "Çekilen dişin yerinin uygun zamanda doldurulmaması komşu dişlerin kaymasına yol açabilir",
    ],
    aftercare: [
      "Tamponu hekiminizin söylediği süre boyunca ısırarak tutun",
      "İlk gün tükürmeyin, sert çalkalama yapmayın, pipetle içmeyin",
      "Sigaradan uzak durun; ılık veya soğuk, yumuşak yiyecekler tercih edin",
      "Kanama durmazsa, ağrı birkaç gün sonra artarsa veya ateş olursa kliniği arayın",
    ],
  }),

  "GOMULU-CEKIM-ONAM": consent({
    title: "GÖMÜLÜ DİŞ CERRAHİSİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Gömülü diş, ağızda tam olarak çıkamamış, kemik veya diş eti içinde kalmış dişlerdir; en sık yirmi yaş dişlerinde görülür.",
      "İşlemde diş eti açılır, gerekirse kemik ve diş küçük parçalara ayrılarak çıkarılır, yara dikişle kapatılır.",
    ],
    benefits: [
      "Tekrarlayan iltihap, ağrı ve şişliğin önlenmesi",
      "Komşu dişte çürük veya kök hasarı oluşmasının önlenmesi",
      "Kist ve benzeri oluşum riskinin azaltılması; ortodontik planın desteklenmesi",
    ],
    risks: [
      "Normal çekime göre daha belirgin şişlik, morarma ve ağrı; ağız açmada birkaç gün kısıtlılık",
      "Alt çenede dişin sinire yakın olması durumunda dudak, çene ucu veya dilde geçici, çok nadiren kalıcı uyuşukluk ya da his değişikliği",
      "Kuru soket, yara enfeksiyonu veya geç iyileşme",
      "Komşu dişin veya dolgusunun zarar görmesi",
      "Üst çenede sinüs ile bağlantı oluşması",
      "Çok nadiren, derin gömülü dişlerde çene kemiğinde kırık",
    ],
    alternatives: [
      "Belirti vermeyen dişlerde düzenli röntgen kontrolü ile izleme",
      "İşlem yapılmazsa iltihap tekrarlayabilir, komşu diş zarar görebilir veya kist gelişebilir",
    ],
    aftercare: [
      "İlk gün yüzünüze aralıklı soğuk uygulayın, başınızı yüksekte tutarak dinlenin",
      "Yumuşak ve ılık besinler tüketin, işlem tarafıyla çiğnemeyin",
      "Dikiş alınacaksa kontrol randevusunu kaçırmayın",
      "Uyuşukluk birkaç gün içinde geçmezse, şişlik artarsa veya ateş olursa kliniği arayın",
    ],
  }),

  "ENDO-ONAM": consent({
    title: "KANAL TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Kanal tedavisi, dişin içindeki iltihaplı veya canlılığını yitirmiş dokunun (pulpa) temizlenmesi, kanalların şekillendirilip dezenfekte edilmesi ve doldurulmasıdır.",
      "Tedavi bir veya birkaç seansta tamamlanabilir. Tedavi sonrası dişin dolgu veya kaplama ile güçlendirilmesi çoğu zaman gerekir.",
    ],
    benefits: [
      "Dişin ağızda korunması ve çekimin önlenmesi",
      "Ağrının ve kök ucundaki iltihabın azaltılması",
    ],
    risks: [
      "Tedavi sonrası birkaç gün çiğnemede hassasiyet veya ağrı",
      "Seanslar arasında alevlenme ve şişlik görülebilmesi",
      "Kanal içinde ince bir aletin kırılması, kanal duvarında delinme gibi istenmeyen durumlar",
      "Eğri, daralmış veya görünmeyen kanallar nedeniyle tedavinin tam yapılamaması",
      "Kanal tedavili dişin zamanla kırılgan hale gelmesi, renk değiştirmesi",
      "İyileşme olmazsa kanal yenileme, kök ucu cerrahisi veya çekim gerekebilmesi",
    ],
    alternatives: [
      "Dişin çekilmesi ve yerine uygun bir protez veya implant planlanması",
      "Tedavi yapılmazsa ağrı ve iltihap ilerleyebilir, apse oluşabilir, diş kaybedilebilir",
    ],
    aftercare: [
      "Geçici dolgu varken o tarafla sert yiyecek çiğnemeyin",
      "Kalıcı dolgu veya kaplama randevunuzu geciktirmeyin",
      "Şişlik, ateş veya giderek artan ağrı olursa kliniği arayın",
    ],
  }),

  "ENDO-TEKRAR-ONAM": consent({
    title: "KANAL TEDAVİSİ YENİLEME BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Kanal tedavisi yenileme, daha önce kanal tedavisi yapılmış ancak iltihabı süren veya yeniden sorun çıkaran bir dişte, eski kanal dolgusunun çıkarılıp kanalların yeniden temizlenmesi ve doldurulmasıdır.",
      "Dişteki eski dolgu, kaplama veya kanal içi pivo gibi yapıların sökülmesi gerekebilir.",
    ],
    benefits: [
      "Dişin ağızda korunmasına yeni bir şans verilmesi",
      "Kök ucundaki iltihabın ve ağrının azaltılması",
    ],
    risks: [
      "İlk kanal tedavisine göre daha uzun ve karmaşık bir süreç; birden fazla seans gerekebilmesi",
      "Eski dolgu ve pivo sökülürken dişte kırık veya çatlak oluşması",
      "Eski dolgu maddesinin tamamen çıkarılamaması, kanal içinde alet kırılması veya delinme",
      "Seanslar arasında alevlenme, şişlik ve hassasiyet",
      "Mevcut kaplamanın yenilenmesinin gerekmesi",
      "İyileşme olmazsa kök ucu cerrahisi veya çekim gerekebilmesi",
    ],
    alternatives: [
      "Kök ucu cerrahisi (apikal rezeksiyon) veya dişin çekilip yerinin protez ya da implantla tamamlanması",
      "Tedavi yapılmazsa iltihap ilerleyebilir, kemik kaybı ve diş kaybı gelişebilir",
    ],
    aftercare: [
      "Geçici dolgu varken o taraftan sert yiyecek çiğnemeyin",
      "Kalıcı üst yapının (dolgu veya kaplama) zamanında yapılmasını sağlayın",
      "Hekiminizin önereceği kontrol röntgenlerine gelin",
      "Şişlik, ateş veya artan ağrı olursa kliniği arayın",
    ],
  }),

  "RESTORATIF-ONAM": consent({
    title: "RESTORATİF VE ESTETİK İŞLEM BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Bu form; kompozit bonding, lamine veneer, inley-onley gibi dişin biçimini, rengini veya bütünlüğünü düzeltmeye yönelik işlemleri kapsar.",
      "Bazı işlemlerde diş yüzeyinden bir miktar doku aşındırılır; bu aşındırma geri alınamaz.",
    ],
    benefits: [
      "Kırık, aşınmış veya renk değiştirmiş dişlerin görünümünün ve işlevinin düzeltilmesi",
      "Diş dokusunun daha fazla kaybının önlenmesi",
    ],
    risks: [
      "Geçici veya uzun süreli sıcak-soğuk hassasiyeti",
      "Malzemede zamanla renk değişimi, kırılma, ayrılma veya aşınma",
      "Doğal diş renginin tam olarak eşleşmemesi; renk ve biçim beklentisinin farklı olması",
      "Aşındırılan dişte nadiren sinir iltihabı ve kanal tedavisi gereksinimi",
      "Restorasyonların belirli aralıklarla yenilenmesinin gerekmesi",
    ],
    alternatives: [
      "Beyazlatma, ortodontik tedavi, kaplama veya işlem yapmadan izleme",
      "Tedavi yapılmazsa kırık ve aşınma ilerleyebilir, estetik sorun sürebilir",
    ],
    aftercare: [
      "Tırnak yeme, kalem ısırma ve sert cisimlerle kabuk kırma gibi alışkanlıklardan kaçının",
      "Gece diş sıkıyorsanız hekiminizin önerdiği koruyucu plağı kullanın",
      "Çay, kahve ve sigara renklenmeyi artırabilir",
      "Kırılma veya ayrılma fark ederseniz kliniği arayın",
    ],
  }),

  "DOLGU-ONAM": consent({
    title: "DOLGU TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Dolgu tedavisi, çürük veya kırık nedeniyle kaybedilen diş dokusunun temizlenip uygun bir dolgu maddesiyle yeniden yapılmasıdır. Gerekirse lokal anestezi uygulanır.",
      "Kullanılacak dolgu maddesi (kompozit, cam iyonomer vb.) dişin durumuna göre hekiminizle birlikte belirlenir.",
    ],
    benefits: [
      "Çürüğün durdurulması ve dişin korunması",
      "Çiğneme işlevinin ve görünümün düzeltilmesi",
    ],
    risks: [
      "Dolgu sonrası birkaç gün veya hafta süren sıcak-soğuk hassasiyeti",
      "Derin çürüklerde sinirin etkilenmesi ve ileride kanal tedavisi gerekebilmesi",
      "Dolguda kırılma, düşme, renk değişimi veya kenarlarda yeni çürük oluşması",
      "Dolgunun yüksek kalmasına bağlı ısırmada rahatsızlık; düzeltme için kısa bir randevu gerekebilir",
    ],
    alternatives: [
      "Çok küçük çürüklerde koruyucu uygulamalar ve izleme; geniş kayıplarda inley-onley veya kaplama",
      "Tedavi yapılmazsa çürük ilerleyerek ağrıya, sinir iltihabına ve diş kaybına yol açabilir",
    ],
    aftercare: [
      "Uyuşukluk geçene kadar yemek yemeyin",
      "Isırmada yükseklik hissederseniz kliniğe bildirin",
      "Düzenli fırçalama, diş ipi ve kontrol randevuları dolgunun ömrünü uzatır",
    ],
  }),

  "BEYAZLATMA-ONAM": consent({
    title: "DİŞ BEYAZLATMA BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Diş beyazlatma, diş yüzeyindeki ve içindeki renklenmelerin beyazlatıcı bir jel yardımıyla açılmasıdır. Klinikte uygulama, evde hekim kontrolünde plakla uygulama veya ikisi birlikte planlanabilir.",
      "Beyazlatma yalnızca doğal dişlere etki eder; dolgu, kaplama ve protezlerin rengi değişmez.",
    ],
    benefits: [
      "Dişlerin renginin açılması ve daha aydınlık bir görünüm",
      "Diş dokusunun aşındırılmasına gerek kalmadan estetik iyileşme",
    ],
    risks: [
      "Uygulama sırasında ve sonrasında geçici diş hassasiyeti",
      "Jelin diş etine temasıyla geçici tahriş veya beyazlaşma",
      "Renk açılmasının kişiden kişiye farklı olması, bazı renklenmelerde sınırlı kalması",
      "Mevcut dolgu ve kaplamaların yeni diş rengine uymaması ve yenilenmesinin istenebilmesi",
      "Sonucun zamanla, özellikle renkli içecekler ve sigara ile azalması",
    ],
    alternatives: [
      "Profesyonel temizlik ve cila, kompozit bonding, lamine veneer veya işlem yapmamak",
      "Beyazlatma yapılmaması sağlık açısından bir sorun oluşturmaz",
    ],
    aftercare: [
      "Uygulamadan sonraki ilk günlerde çay, kahve, kola ve sigaradan uzak durun",
      "Ev plağını yalnızca hekiminizin anlattığı şekilde ve sürede kullanın",
      "Belirgin hassasiyet veya diş eti tahrişi olursa uygulamaya ara verip kliniği arayın",
      "Gebelik veya emzirme dönemindeyseniz uygulama öncesi hekiminize bildirin",
    ],
  }),

  "PROTEZ-ONAM": consent({
    title: "PROTEZ İŞLEMLERİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Protez tedavisi, eksik dişlerin veya ileri derecede hasarlı diş dokusunun sabit (kron, köprü) veya hareketli (tam ya da bölümlü) yapılarla tamamlanmasıdır.",
      "Tedavi genellikle ölçü, prova ve teslim aşamalarından oluşur; dişlerin hazırlanması için aşındırma gerekebilir.",
    ],
    benefits: [
      "Çiğneme ve konuşma işlevinin iyileştirilmesi",
      "Görünümün düzeltilmesi ve komşu dişlerin kaymasının önlenmesi",
    ],
    risks: [
      "Aşındırılan dişlerde hassasiyet; nadiren sinir iltihabı ve kanal tedavisi gereksinimi",
      "Alışma döneminde baskı yarası, konuşmada değişiklik, tükürük artışı",
      "Protezde kırılma, sökülme, renk değişimi veya zamanla uyumun bozulması",
      "Ağız hijyeni yetersiz olursa protez altındaki dişlerde çürük ve diş eti hastalığı",
      "Beklenen renk ve biçimin tam olarak karşılanamaması",
    ],
    alternatives: [
      "İmplant destekli protez, farklı protez türleri veya eksik bölgeyi bırakmak",
      "Tedavi yapılmazsa çiğneme güçlüğü sürebilir, komşu ve karşı dişler kayabilir",
    ],
    aftercare: [
      "Teslimden sonra size verilen kullanım ve temizlik talimatlarına uyun",
      "Ağrı veya yara oluşursa kendi başınıza düzeltmeye çalışmadan kliniği arayın",
      "Düzenli kontrollerle protezin uyumunu kontrol ettirin",
    ],
  }),

  "KRON-KOPRU-ONAM": consent({
    title: "KRON VE KÖPRÜ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Kron (kaplama), dişin tamamını saran sabit bir yapıdır. Köprü ise eksik dişin iki yanındaki dişlerden destek alarak boşluğu kapatan sabit bir protezdir.",
      "Dişler belirli ölçüde aşındırılır, ölçü alınır, gerekirse geçici kaplama takılır ve son yapı dişlere yapıştırılır. Aşındırma geri alınamaz.",
    ],
    benefits: [
      "Zayıflamış dişin güçlendirilmesi ve kırılmaya karşı korunması",
      "Eksik dişin sabit olarak tamamlanması; çiğneme ve görünümün iyileşmesi",
    ],
    risks: [
      "Aşındırma sonrası hassasiyet; nadiren sinir iltihabı ve kanal tedavisi gereksinimi",
      "Geçici kaplamanın düşmesi veya kırılması",
      "Seramik veya kaplama malzemesinde kırılma, çatlama, yapıştırıcının çözülmesi",
      "Kaplama kenarında çürük veya diş eti çekilmesi; köprü altında yemek birikmesi",
      "Destek dişlerden birinde sorun olursa köprünün tamamının yenilenmesinin gerekebilmesi",
    ],
    alternatives: [
      "Büyük dolgu veya inley-onley, implant destekli kron, hareketli bölümlü protez",
      "Tedavi yapılmazsa zayıf diş kırılabilir, boşluğa komşu dişler kayabilir",
    ],
    aftercare: [
      "Geçici kaplama ile yapışkan ve sert yiyeceklerden kaçının",
      "Köprü altını diş ipi geçirici veya ara yüz fırçasıyla temizleyin",
      "Isırmada yükseklik, ağrı veya sallanma fark ederseniz kliniği arayın",
    ],
  }),

  "TAM-PROTEZ-ONAM": consent({
    title: "TAM VE BÖLÜMLÜ HAREKETLİ PROTEZ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Hareketli protez, hastanın takıp çıkarabildiği bir yapıdır. Tam protez çenede hiç diş olmadığında, bölümlü protez ise bazı dişler mevcutken kullanılır.",
      "Tedavi birkaç ölçü, kayıt ve prova seansı ile teslim ve teslim sonrası düzeltme randevularını içerir.",
    ],
    benefits: [
      "Çiğneme ve konuşmanın iyileştirilmesi",
      "Yüz ve dudak desteğinin, görünümün düzeltilmesi",
    ],
    risks: [
      "Alışma döneminde baskı yaraları, bulantı hissi, tükürük artışı ve konuşmada geçici değişiklik",
      "Özellikle alt tam protezde tutuculuğun sınırlı olması",
      "Zamanla kemik erimesine bağlı uyumun bozulması ve besleme ya da yenileme gereksinimi",
      "Protezin kırılması veya bölümlü protezde kroşelerin zamanla gevşemesi",
      "Temizlik yetersiz olursa ağız mantarı, kötü koku, destek dişlerde çürük",
    ],
    alternatives: [
      "İmplant destekli hareketli veya sabit protez, uygunsa sabit köprü",
      "Tedavi yapılmazsa çiğneme ve konuşma güçlüğü sürebilir, kalan dişler kayabilir",
    ],
    aftercare: [
      "Protezi her yemekten sonra çıkarıp yumuşak fırça ve uygun temizleyiciyle temizleyin",
      "Hekiminiz başka bir öneride bulunmadıkça geceleri protezi çıkararak dokuların dinlenmesini sağlayın",
      "Yara oluşursa protezi kendiniz törpülemeyin; kliniği arayın",
      "Düzenli kontrollere gelin",
    ],
  }),

  "IMPLANT-ONAM": consent({
    title: "İMPLANT TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Dental implant, eksik dişin kökü yerine çene kemiğine yerleştirilen, genellikle titanyumdan yapılmış vida biçiminde bir parçadır. Kemikle kaynaşma süresinden sonra üzerine protez yapılır.",
      "Kemik miktarı yetersizse ek kemik grefti veya sinüs işlemi gerekebilir. Cerrahi aşama genellikle lokal anestezi altında yapılır.",
    ],
    benefits: [
      "Komşu dişleri aşındırmadan eksik dişin tamamlanması",
      "Sabit veya daha iyi tutunan protezlerle çiğneme ve konuşmanın iyileşmesi",
      "Bölgedeki kemiğin korunmasına katkı",
    ],
    risks: [
      "İşlem sonrası ağrı, şişlik, morarma ve kanama",
      "Yara enfeksiyonu veya yaranın açılması",
      "İmplantın kemikle kaynaşmaması veya ileride kaybedilmesi; bu durumda çıkarılması gerekebilir",
      "Alt çenede sinir yakınlığına bağlı geçici, çok nadiren kalıcı uyuşukluk",
      "Üst çenede sinüs ile ilişkili sorunlar",
      "Sigara, kontrolsüz şeker hastalığı ve yetersiz ağız bakımının sorun riskini artırması",
      "Uzun dönemde implant çevresi iltihabı ve kemik kaybı",
    ],
    alternatives: [
      "Sabit köprü, hareketli bölümlü veya tam protez ya da boşluğu bırakmak",
      "Tedavi yapılmazsa komşu dişler kayabilir, bölgedeki kemik zamanla azalabilir",
    ],
    aftercare: [
      "İlk gün soğuk uygulayın, yumuşak beslenin, işlem bölgesiyle çiğnemeyin",
      "Sigaradan mümkün olduğunca uzak durun",
      "İlaçları yalnızca hekiminizin önerdiği şekilde kullanın",
      "İyileşme ve protez sonrası kontrol randevularına mutlaka gelin",
    ],
  }),

  "IMPLANT-USTU-ONAM": consent({
    title: "İMPLANT ÜSTÜ PROTEZ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "İmplant üstü protez, kemikle kaynaşmış implantların üzerine yapılan kron, köprü veya hareketli protezdir. Vidalı ya da yapıştırmalı olarak sabitlenebilir; hareketli türleri implantlara tutunur.",
      "Tedavi ölçü, prova ve teslim aşamalarını içerir.",
    ],
    benefits: [
      "Eksik dişlerin implant desteğiyle sabit veya iyi tutunan biçimde tamamlanması",
      "Çiğneme gücünün ve konuşmanın iyileşmesi",
    ],
    risks: [
      "Vidanın gevşemesi, protezin sökülmesi veya seramikte kırılma",
      "Hareketli türlerde tutucu parçaların zamanla aşınıp değiştirilmesinin gerekmesi",
      "Protez altında yemek birikmesi; temizlik yetersizse implant çevresi iltihabı",
      "Görünüm ve diş eti seviyesinin doğal dişten farklı olabilmesi",
      "Diş sıkma ve gıcırdatmanın protez ve implantlara aşırı yük bindirmesi",
    ],
    alternatives: [
      "Farklı protez türleri (vidalı, yapıştırmalı, hareketli) arasında hekiminizle seçim yapılabilir",
      "Protez yapılmazsa implant işlev görmez ve bölgede çiğneme yapılamaz",
    ],
    aftercare: [
      "İmplant çevresini ara yüz fırçası, diş ipi veya ağız duşuyla her gün temizleyin",
      "Gece diş sıkıyorsanız koruyucu plak kullanın",
      "Sallanma, ses veya ağrı fark ederseniz kliniği arayın",
      "Yılda en az bir kez kontrol ve profesyonel temizlik yaptırın",
    ],
  }),

  "SINUS-LIFT-ONAM": consent({
    title: "SİNÜS TABANI YÜKSELTME VE KEMİK GREFTİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Üst çene arka bölgede kemik yüksekliği implant için yetersizse, sinüs boşluğunun tabanındaki zar dikkatle kaldırılır ve altına kemik grefti yerleştirilir. Bu işleme sinüs tabanı yükseltme denir.",
      "Diğer bölgelerde de kemik eksikliği kemik grefti ve gerekirse zar (membran) ile tamamlanabilir. Greft, hastanın kendi kemiği veya hazır greft malzemesi olabilir. İmplant aynı seansta veya iyileşmeden sonra yerleştirilebilir.",
    ],
    benefits: [
      "İmplant yerleştirmek için yeterli kemik hacmi oluşturulması",
      "Daha uzun dönemde implant desteği sağlanmasına katkı",
    ],
    risks: [
      "Şişlik, morarma, ağrı ve burun kanaması",
      "Sinüs zarının yırtılması; işlemin ertelenmesi veya farklı yöntem gerekmesi",
      "Sinüs iltihabı, burun tıkanıklığı veya akıntı",
      "Greftin tutmaması, enfeksiyonu veya bir kısmının kaybı",
      "Ek kemik alınan bölgede ağrı ve şişlik",
      "Gereken kemik oluşmazsa işlemin tekrarı veya planın değişmesi",
    ],
    alternatives: [
      "Daha kısa implantlar, farklı açılı implant yöntemleri, sabit köprü veya hareketli protez",
      "İşlem yapılmazsa bölgeye standart implant yerleştirilemeyebilir",
    ],
    aftercare: [
      "Hekiminiz izin verene kadar sert burun sümkürmeyin, hapşırırken ağzınızı açık tutun",
      "Pipet kullanmayın, sigara içmeyin, ağır egzersizden kaçının",
      "Uçak yolculuğu ve dalış için hekiminize danışın",
      "Burundan greft parçacığı gelmesi, ateş veya artan ağrı olursa kliniği arayın",
    ],
  }),

  "PERIO-ONAM": consent({
    title: "PERİODONTAL TEDAVİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Periodontal tedavi, dişleri çevreleyen diş eti ve kemikte oluşan iltihabın (diş eti hastalığı) tedavisidir. Diş taşı temizliği, kök yüzeyi düzleştirme ve gerekirse cerrahi işlemleri kapsar.",
      "Tedavinin başarısı büyük ölçüde evde yapılan düzenli ağız bakımına ve kontrol randevularına bağlıdır.",
    ],
    benefits: [
      "Diş eti kanamasının ve iltihabın azaltılması",
      "Kemik kaybının ilerlemesinin yavaşlatılması, dişlerin daha uzun süre korunması",
      "Ağız kokusunun azalması",
    ],
    risks: [
      "Tedavi sonrası hassasiyet ve hafif ağrı",
      "İltihap geriledikçe diş etlerinin çekilmesi, diş aralarının belirginleşmesi",
      "Sıcak-soğuk hassasiyetinin bir süre devam etmesi",
      "İleri kemik kaybı olan dişlerde sallanmanın sürmesi ve diş kaybı",
      "Hastalığın düzenli bakım yapılmazsa tekrarlaması",
    ],
    alternatives: [
      "İleri vakalarda cerrahi tedavi veya korunamayan dişlerin çekimi",
      "Tedavi yapılmazsa diş eti hastalığı ilerleyerek kemik kaybına ve dişlerin kaybına yol açabilir",
    ],
    aftercare: [
      "Size gösterilen fırçalama ve ara yüz temizliği yöntemlerini her gün uygulayın",
      "Sigara diş eti iyileşmesini olumsuz etkiler; bırakmanız önerilir",
      "Belirlenen aralıklarla bakım randevularına gelin",
    ],
  }),

  "PERIO-BASLANGIC-ONAM": consent({
    title: "DİŞ TAŞI TEMİZLİĞİ VE KÖK YÜZEYİ DÜZLEŞTİRME BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Diş taşı temizliği, diş yüzeyinde ve diş eti kenarında biriken sertleşmiş plağın el aletleri veya ultrasonik cihazlarla temizlenmesidir.",
      "Kök yüzeyi düzleştirme ise diş eti cebinin derinlerindeki taş ve bakteri birikintilerinin temizlenip kök yüzeyinin pürüzsüz hale getirilmesidir. Gerekirse lokal anestezi uygulanır ve tedavi bölgelere ayrılarak birkaç seansta yapılabilir.",
    ],
    benefits: [
      "Diş eti iltihabının ve kanamanın azalması",
      "Diş eti ceplerinin sığlaşmasına katkı",
      "Ağız kokusunun azalması ve daha kolay ağız bakımı",
    ],
    risks: [
      "Birkaç gün süren diş eti hassasiyeti ve hafif kanama",
      "Sıcak-soğuk hassasiyeti",
      "İltihap azaldıkça diş eti seviyesinin bir miktar çekilmesi ve diş aralarında boşluk görünümü",
      "Taşın daha önce bir arada tuttuğu sallantılı dişlerde hareketin belirginleşmesi",
      "Mevcut dolgu ve kaplama kenarlarının daha görünür hale gelmesi",
    ],
    alternatives: [
      "Yalnızca evde bakımın güçlendirilmesi (iltihap varsa yeterli olmayabilir), ileri vakalarda cerrahi tedavi",
      "Tedavi yapılmazsa diş eti hastalığı ilerleyebilir, kemik kaybı ve diş kaybı gelişebilir",
    ],
    aftercare: [
      "İlk günlerde yumuşak fırçayla nazikçe fırçalayın, ara yüz temizliğini bırakmayın",
      "Hassasiyet için hekiminizin önerdiği ürünleri kullanın",
      "Yeniden değerlendirme randevusuna mutlaka gelin",
    ],
  }),

  "PERIO-CERRAHI-ONAM": consent({
    title: "PERİODONTAL CERRAHİ (FLEP) BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Flep operasyonu, temizlikle yeterince iyileşmeyen derin diş eti ceplerinde, diş etinin lokal anestezi altında kaldırılarak kök yüzeylerinin ve kemiğin doğrudan görülerek temizlenmesidir.",
      "Gerekirse kemik düzeltmesi yapılır veya kemik grefti ve zar uygulanır; diş eti dikişle yerine kapatılır.",
    ],
    benefits: [
      "Derin ceplerdeki birikintilerin daha etkili temizlenmesi",
      "Cep derinliğinin azaltılması ve evde temizliğin kolaylaşması",
      "Hastalığın ilerlemesinin yavaşlatılması",
    ],
    risks: [
      "Ağrı, şişlik, morarma ve kanama",
      "Diş eti çekilmesi; diş boylarının uzun görünmesi, ön bölgede estetik değişiklik",
      "Sıcak-soğuk hassasiyetinin artması",
      "Yara enfeksiyonu, dikişlerin açılması veya geç iyileşme",
      "Greft uygulandıysa greftin tutmaması",
      "Hastalığın düzenli bakım yapılmazsa tekrarlaması",
    ],
    alternatives: [
      "Cerrahi olmayan tedavinin tekrarı ve yakın izleme; korunamayan dişlerin çekimi",
      "İşlem yapılmazsa derin ceplerde iltihap sürebilir, kemik kaybı ilerleyebilir",
    ],
    aftercare: [
      "İlk gün soğuk uygulayın, işlem bölgesini fırçalamayın; hekimin önerdiği gargarayı anlatıldığı gibi kullanın",
      "Yumuşak ve ılık besinler tercih edin, sigara içmeyin",
      "Dikiş alma ve kontrol randevularına gelin",
      "Kanama durmazsa veya şişlik artarsa kliniği arayın",
    ],
  }),

  "DISETI-GREFT-ONAM": consent({
    title: "DİŞ ETİ GREFTİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Diş eti grefti, çekilmiş veya incelmiş diş eti bölgelerini güçlendirmek ya da açıkta kalan kök yüzeyini örtmek amacıyla yapılan bir cerrahi işlemdir.",
      "Doku çoğunlukla damaktan alınır; bazı durumlarda hazır doku malzemeleri kullanılabilir. İşlem lokal anestezi altında yapılır ve dikişle tamamlanır.",
    ],
    benefits: [
      "Diş eti çekilmesinin ilerlemesinin yavaşlatılması",
      "Açıkta kalan kök yüzeyinin örtülmesi ve hassasiyetin azalması",
      "Diş eti görünümünün iyileştirilmesi",
    ],
    risks: [
      "Doku alınan damak bölgesinde birkaç gün süren ağrı ve kanama",
      "Şişlik, morarma ve hassasiyet",
      "Greftin kısmen veya tamamen tutmaması",
      "Kök yüzeyinin beklenen ölçüde örtülememesi; diş eti renk ve kalınlığının çevreden farklı olması",
      "Enfeksiyon veya geç iyileşme",
    ],
    alternatives: [
      "Fırçalama alışkanlığının düzeltilmesi ve düzenli izleme, hassasiyet giderici uygulamalar, dolgu ile kök yüzeyinin kapatılması",
      "İşlem yapılmazsa çekilme ilerleyebilir, hassasiyet ve kök çürüğü riski artabilir",
    ],
    aftercare: [
      "İşlem bölgesini hekiminiz izin verene kadar fırçalamayın ve dudağınızı çekerek bakmayın",
      "Varsa damak koruyucu plağı anlatıldığı gibi kullanın",
      "Sıcak, sert ve baharatlı yiyeceklerden kaçının, sigara içmeyin",
      "Kanama durmazsa veya şişlik artarsa kliniği arayın",
    ],
  }),

  "KRON-BOYU-ONAM": consent({
    title: "KRON BOYU UZATMA BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Kron boyu uzatma, dişin diş eti üzerinde kalan kısmını artırmak için diş eti ve gerekirse çevre kemiğin bir miktar düzenlenmesidir.",
      "Çoğunlukla diş eti seviyesinin altına uzanan çürük veya kırıklarda dolgu ya da kaplamanın sağlıklı yapılabilmesi için ya da estetik amaçla uygulanır. İşlem lokal anestezi altında yapılır.",
    ],
    benefits: [
      "Yapılacak dolgu veya kaplamanın sağlam bir diş yüzeyine oturması",
      "Diş eti sağlığının korunmasına katkı; estetik vakalarda diş eti çizgisinin düzenlenmesi",
    ],
    risks: [
      "Ağrı, şişlik ve hassasiyet",
      "Diş boyunun uzun görünmesi, diş aralarında boşluk oluşması",
      "Kök yüzeyi açığa çıktığı için sıcak-soğuk hassasiyeti",
      "Komşu dişlerde de diş eti seviyesinin değişebilmesi",
      "İyileşme sürecinde diş eti seviyesinin bir miktar değişmesi; nihai kaplama için bekleme gerekmesi",
    ],
    alternatives: [
      "Ortodontik yolla dişin yukarı çekilmesi, dişin çekilip implant veya köprü yapılması",
      "İşlem yapılmazsa yapılacak restorasyonun uyumu ve ömrü olumsuz etkilenebilir",
    ],
    aftercare: [
      "İşlem bölgesini ilk günlerde nazikçe temizleyin, hekimin önerdiği gargarayı kullanın",
      "Yumuşak besinler tercih edin, sigara içmeyin",
      "Kalıcı kaplama için önerilen iyileşme süresini bekleyin",
    ],
  }),

  "FRENEKTOMI-ONAM": consent({
    title: "FRENEKTOMİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Frenulum, dudağı veya dili ağız içine bağlayan ince doku bandıdır. Frenektomi, bu bandın kısa ya da kalın olduğu ve sorun yarattığı durumlarda gevşetilmesi veya çıkarılmasıdır.",
      "İşlem lokal anestezi altında, bisturi veya lazer ile yapılabilir; gerekirse dikiş atılır.",
    ],
    benefits: [
      "Dil veya dudak hareketinin rahatlaması",
      "Diş eti çekilmesine yol açan çekmenin azaltılması",
      "Ortodontik tedavide diş arası boşluğun kapanmasının desteklenmesi; protez uyumunun iyileşmesi",
    ],
    risks: [
      "Hafif ağrı, şişlik ve kanama",
      "İyileşme döneminde yemek ve konuşmada geçici rahatsızlık",
      "Yara yerinde skar dokusu oluşması veya bandın yeniden oluşması",
      "Enfeksiyon veya geç iyileşme",
      "Dil frenulumu işlemlerinde konuşma güçlüğü varsa, ek konuşma terapisi gerekebilmesi",
    ],
    alternatives: [
      "İzleme, ortodontik veya konuşma terapisi gibi cerrahi olmayan yaklaşımlar",
      "İşlem yapılmazsa mevcut çekme, hareket kısıtlılığı veya boşluk sorunu sürebilir",
    ],
    aftercare: [
      "Hekiminizin önerdiği dil ve dudak egzersizlerini düzenli yapın",
      "İlk günlerde sıcak, sert ve baharatlı yiyeceklerden kaçının",
      "Kanama durmazsa veya şişlik artarsa kliniği arayın",
    ],
  }),

  "APIKAL-REZ-ONAM": consent({
    title: "APİKAL REZEKSİYON BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Apikal rezeksiyon (kök ucu cerrahisi), kanal tedavisine rağmen kök ucunda iltihabı süren dişlerde, diş eti açılarak kök ucunun ve çevresindeki iltihaplı dokunun temizlenmesi ve kök ucunun kapatılmasıdır.",
      "İşlem lokal anestezi altında yapılır, yara dikişle kapatılır. Çıkarılan doku gerekirse patolojik incelemeye gönderilir.",
    ],
    benefits: [
      "Dişin çekilmeden korunmasına yönelik bir seçenek sunması",
      "Kök ucundaki iltihabın ve tekrarlayan şişliğin azaltılması",
    ],
    risks: [
      "Ağrı, şişlik, morarma ve kanama",
      "Diş eti çekilmesi veya ön bölgede yara izi",
      "Komşu sinir, sinüs veya dişlerin etkilenmesi; geçici uyuşukluk",
      "Kök boyunun kısalmasına bağlı dişte sallanma artışı",
      "İyileşmenin gerçekleşmemesi ve dişin ileride çekilmesinin gerekebilmesi",
    ],
    alternatives: [
      "Kanal tedavisinin yenilenmesi, dişin çekilip yerine implant veya köprü yapılması",
      "İşlem yapılmazsa iltihap sürebilir, kemik kaybı artabilir ve diş kaybedilebilir",
    ],
    aftercare: [
      "İlk gün soğuk uygulayın, işlem bölgesiyle çiğnemeyin",
      "Dudağınızı çekip yarayı kontrol etmeyin",
      "Dikiş alma ve kontrol röntgeni randevularına gelin",
      "Şişlik artarsa veya ateş olursa kliniği arayın",
    ],
  }),

  "KIST-ONAM": consent({
    title: "KİST VE LEZYON CERRAHİSİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Çene kemiğinde veya ağız içi yumuşak dokularda bulunan kist ya da başka bir oluşumun (lezyon) cerrahi olarak çıkarılmasıdır.",
      "Çıkarılan doku, kesin tanı için patoloji laboratuvarına gönderilir. Büyük kistlerde önce boşaltma işlemi ve ardından ikinci bir operasyon planlanabilir. Kist ile ilişkili dişlerin tedavisi veya çekimi gerekebilir.",
    ],
    benefits: [
      "Oluşumun büyümesinin ve çevre dokulara zarar vermesinin önlenmesi",
      "Kesin tanının konulması",
      "Enfeksiyon ve ağrı kaynağının ortadan kaldırılması",
    ],
    risks: [
      "Ağrı, şişlik, morarma ve kanama",
      "Komşu dişlerin canlılığını yitirmesi ve kanal tedavisi gerekmesi",
      "Sinire yakın lezyonlarda dudak, çene veya dilde geçici, çok nadiren kalıcı uyuşukluk",
      "Üst çenede sinüs veya burun boşluğu ile bağlantı oluşması",
      "Kistin tekrarlaması; çok nadiren geniş kistlerde çene kırığı",
      "Patoloji sonucuna göre ek tedavi veya ileri merkeze yönlendirme gerekebilmesi",
    ],
    alternatives: [
      "Küçük ve belirti vermeyen bazı oluşumlarda düzenli görüntüleme ile izleme",
      "İşlem yapılmazsa oluşum büyüyebilir, enfekte olabilir veya kemiği zayıflatabilir",
    ],
    aftercare: [
      "Hekimin verdiği yara bakımı ve beslenme önerilerine uyun",
      "Patoloji sonucu için kontrol randevusuna mutlaka gelin",
      "Ateş, artan şişlik veya kanama olursa kliniği arayın",
    ],
  }),

  "BIYOPSI-ONAM": consent({
    title: "BİYOPSİ VE PATOLOJİ İNCELEMESİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Biyopsi, ağız içinde veya çevresinde görülen bir değişikliğin ne olduğunu anlamak için o bölgeden küçük bir doku parçası alınmasıdır. Lezyonun bir kısmı ya da tamamı alınabilir.",
      "İşlem lokal anestezi altında yapılır. Alınan doku, uzman bir patolog tarafından incelenmek üzere laboratuvara gönderilir; sonucun çıkması belirli bir süre alır.",
    ],
    benefits: [
      "Doğru tanının konulması ve uygun tedavinin planlanması",
      "Ciddi bir hastalık varsa erken fark edilmesi",
    ],
    risks: [
      "Hafif ağrı, şişlik ve kanama",
      "Yara yerinde geçici rahatsızlık, nadiren enfeksiyon",
      "Bölgede küçük bir yara izi kalması",
      "Sinire yakın bölgelerde geçici uyuşukluk",
      "Alınan dokunun tanı için yeterli olmaması ve biyopsinin tekrarlanmasının gerekebilmesi",
    ],
    alternatives: [
      "Kısa süreli izleme ve yeniden değerlendirme veya başka bir merkeze yönlendirme",
      "Biyopsi yapılmazsa kesin tanı konulamaz; tedavinin gecikmesi söz konusu olabilir",
    ],
    aftercare: [
      "İşlem bölgesini ilk gün rahatsız etmeyin, sıcak ve baharatlı yiyeceklerden kaçının",
      "Sonucu öğrenmek ve sonraki adımı planlamak için kontrol randevusuna mutlaka gelin",
      "Patoloji sonucunun size ve gerektiğinde yönlendirildiğiniz hekime iletileceğini biliniz",
      "Kanama durmazsa veya şişlik artarsa kliniği arayın",
    ],
  }),

  "ORTO-ONAM": consent({
    title: "ORTODONTİK TEDAVİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Ortodontik tedavi, dişlerin ve çenelerin konumunu düzeltmek için sabit braketler, şeffaf plaklar veya hareketli apareylerle yapılan, aylar ya da yıllar süren bir tedavidir.",
      "Tedavi süresi tahminidir; dişlerin yanıtına, hastanın uyumuna ve randevulara düzenli gelinmesine göre değişir. Tedavi sonunda pekiştirme (retansiyon) aşaması gerekir.",
    ],
    benefits: [
      "Dişlerin daha düzgün dizilmesi ve kapanışın iyileşmesi",
      "Temizliğin kolaylaşması, çiğneme işlevinin desteklenmesi",
      "Gülüş görünümünün iyileşmesi",
    ],
    risks: [
      "Aparey takıldıktan ve aktivasyonlardan sonra birkaç gün süren ağrı ve hassasiyet",
      "Yanak ve dudakta tahriş, küçük yaralar",
      "Ağız bakımı yetersizse çürük, diş yüzeyinde beyaz lekeler ve diş eti iltihabı",
      "Kök boyunda kısalma, diş eti çekilmesi",
      "Çene eklemi rahatsızlıklarının ortaya çıkması veya artması",
      "Pekiştirme aygıtı kullanılmazsa dişlerin eski konumuna dönmesi",
      "Büyümenin beklenenden farklı seyretmesi nedeniyle planın uzaması veya cerrahi gerekebilmesi",
    ],
    alternatives: [
      "Farklı aparey türleri, protetik veya estetik düzeltmeler, ciddi çene bozukluklarında ortognatik cerrahi",
      "Tedavi yapılmazsa çapraşıklık ve kapanış bozukluğu sürer; temizlik güçlüğü ve aşınma artabilir",
    ],
    aftercare: [
      "Her yemekten sonra dişlerinizi ve apareyinizi temizleyin",
      "Sert, yapışkan ve şekerli yiyeceklerden kaçının",
      "Kopan braket veya batan teli kliniğe bildirin",
      "Kontrol randevularına düzenli gelin ve pekiştirme aygıtını anlatıldığı gibi kullanın",
    ],
  }),

  "SEFFAF-PLAK-ONAM": consent({
    title: "ŞEFFAF PLAK TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Şeffaf plak tedavisi, dijital planlama ile üretilen ve belirli aralıklarla değiştirilen şeffaf plaklarla dişlerin adım adım hareket ettirilmesidir.",
      "Dişlere küçük dolgu çıkıntıları (ataşman) yapıştırılabilir ve dişler arasında hafif aşındırma gerekebilir. Plakların günün büyük bölümünde takılı kalması tedavinin işlemesi için esastır.",
    ],
    benefits: [
      "Dişlerin daha düzgün dizilmesi ve kapanışın iyileşmesi",
      "Görünürlüğü az ve çıkarılabilir bir aparey",
      "Fırçalama ve diş ipi kullanımının kolay olması",
    ],
    risks: [
      "Yeni plak takıldığında birkaç gün süren baskı ve hassasiyet",
      "Plakların yeterli süre takılmaması halinde dişlerin planlanan hareketi yapmaması ve sürenin uzaması",
      "Ek plak (düzeltme) aşamaları veya ek aparey gerekebilmesi",
      "Plak takılıyken şekerli içecek tüketilmesine bağlı çürük riski",
      "Ataşmanların düşmesi; konuşmada geçici değişiklik",
      "Kök kısalması, diş eti çekilmesi, çene eklemi rahatsızlığı",
      "Pekiştirme aygıtı kullanılmazsa dişlerin eski konumuna dönmesi",
    ],
    alternatives: [
      "Sabit braket tedavisi, hareketli aparey, protetik veya estetik düzeltmeler",
      "Tedavi yapılmazsa çapraşıklık ve kapanış bozukluğu sürer",
    ],
    aftercare: [
      "Plakları yemek ve su dışındaki içeceklerden önce çıkarın, dişlerinizi fırçalayıp yeniden takın",
      "Plakları soğuk veya ılık suyla temizleyin; sıcak su ile yıkamayın",
      "Plak değiştirme takvimine ve kontrol randevularına uyun",
      "Kırılan veya kaybolan plağı kliniğe bildirin",
    ],
  }),

  "PEDO-ONAM": consent({
    title: "ÇOCUK HASTA (VELİ/VASİ) BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Bu form, aşağıda adı yazılı çocuğun diş tedavisi için anne, baba ya da yasal vasisinin bilgilendirilmesi ve onayının alınması amacıyla hazırlanmıştır.",
      "Çocuklarda muayene, flor ve fissür örtücü gibi koruyucu uygulamalar, süt ve daimi dişlerde dolgu, süt dişi kanal tedavisi (pulpotomi ve benzeri), çekim ve yer tutucu gibi işlemler yapılabilir. Uyuşturma gerekebilir.",
    ],
    benefits: [
      "Ağrı ve enfeksiyonun giderilmesi, çocuğun rahat yemek yiyebilmesi",
      "Süt dişlerinin doğal düşme zamanına kadar korunması, daimi dişlerin sağlıklı sürmesinin desteklenmesi",
      "Diş hekimine karşı olumlu bir alışkanlık kazanılması",
    ],
    risks: [
      "Uyuşukluk sırasında çocuğun dudak, yanak veya dilini ısırması",
      "Tedavi sonrası geçici hassasiyet ve hafif ağrı",
      "Dolguların düşmesi veya kırılması, tedavili dişte yeniden sorun çıkması",
      "Çocuğun ani hareketine bağlı küçük yumuşak doku yaralanmaları; çekim sonrası kanama ve şişlik",
      "Çocuğun uyumu sağlanamazsa tedavinin seanslara bölünmesi, ertelenmesi veya başka bir merkeze yönlendirme",
    ],
    alternatives: [
      "Tedavinin ertelenmesi, farklı tedavi seçenekleri veya sedasyon ya da genel anestezi imkânı olan bir merkeze yönlendirme",
      "Tedavi yapılmazsa çürük ilerleyebilir, apse gelişebilir ve alttaki daimi diş etkilenebilir",
    ],
    aftercare: [
      "Uyuşukluk geçene kadar çocuğunuzu yakından izleyin, yemek vermeyin ve dudağını ısırmamasını hatırlatın",
      "Fırçalamaya yardımcı olun, şekerli yiyecek ve içecekleri sınırlayın",
      "Ateş, şişlik veya geçmeyen ağrı olursa kliniği arayın",
    ],
    statement: [
      "Çocuğumun planlanan tedavisinin amacı, yararları, olası riskleri ve alternatifleri bana sözlü olarak anlatıldı; bu metni okudum.",
      "Sorularımı sorma fırsatı buldum ve yanıtlandı.",
      "İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum.",
      "Çocuğumun sağlık durumu, kullandığı ilaçlar ve alerjileri hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.",
      "Çocuğun velisi veya yasal vasisi olduğumu beyan ederim.",
      "Tedavi sonucunun çocuktan çocuğa değişebileceğini ve kesin sonuç sözü verilmediğini anladım.",
      "Bu bilgiler ışığında çocuğumun planlanan tedavisine onay veriyorum.",
    ],
    signature: [
      "Çocuğun adı soyadı: {{hasta.ad_soyad}} (Dosya no: {{hasta.dosya_no}})",
      "Veli / vasi adı soyadı: ______________________   İmza: __________",
      "Yakınlığı: [ ] Anne  [ ] Baba  [ ] Vasi  [ ] Diğer: ______________",
      "Veli / vasi telefon: ______________________",
      "Hekim: {{hekim.ad}}   İmza: __________",
      "Tarih: {{belge.tarih}}",
    ],
  }),

  "TRAVMA-ONAM": consent({
    title: "ACİL / TRAVMA TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Bu form, ani ağrı, şişlik veya düşme, çarpma gibi bir travma sonrası yapılan acil diş tedavileri için hazırlanmıştır.",
      "Amaç ağrıyı ve enfeksiyonu kontrol altına almak, kırık veya yerinden oynamış dişleri mümkün olduğunca korumaktır. Kırık parça yapıştırma, dişin yerine konup sabitlenmesi, geçici dolgu veya apse boşaltma gibi işlemler yapılabilir. Kalıcı tedavi çoğu zaman sonra planlanır.",
    ],
    extra: [
      {
        heading: "OLAYIN KISA ÖYKÜSÜ (hekim tarafından doldurulur)",
        lines: ["Olay tarihi / saati: __________   Nasıl oldu: ____________________", "Etkilenen dişler: ____________________"],
      },
    ],
    benefits: [
      "Ağrının ve enfeksiyonun hızla azaltılması",
      "Kırık veya yerinden çıkmış dişin korunma şansının artırılması",
    ],
    risks: [
      "Travmalı dişin zamanla canlılığını yitirmesi, renk değiştirmesi, kanal tedavisi gerektirmesi",
      "Kökte emilme veya dişin kemikle kaynaşması gibi geç dönemde ortaya çıkabilen sorunlar",
      "Yerine yerleştirilen dişin tutunmaması ve kaybedilmesi",
      "Acil koşullarda tam değerlendirme yapılamaması nedeniyle planın sonradan değişmesi; işlem sonrası ağrı ve şişlik",
    ],
    alternatives: [
      "Yalnızca ağrı kontrolü yapıp kapsamlı tedaviyi ertelemek, çekim veya başka merkeze yönlendirme",
      "Tedavi yapılmazsa ağrı ve enfeksiyon artabilir, dişin korunma şansı azalabilir",
    ],
    aftercare: [
      "Hekiminizin önerdiği süre boyunca yumuşak beslenin, travmalı dişle ısırmayın",
      "Sabitleme varsa bölgeyi nazikçe temizleyin",
      "Renk değişimi, şişlik veya ağrı fark ederseniz kliniği arayın",
      "Travmalı dişlerin uzun süre izlenmesi gerekir; kontrol randevularına gelin",
    ],
  }),

  "OZEL-ISLEM-ONAM": consent({
    title: "İŞLEME ÖZGÜ BİLGİLENDİRME VE ONAM FORMU",
    definition: [
      "Bu form, diğer formlarda ayrıca yer almayan bir işlem için kullanılır. İşlemin adı, amacı, riskleri ve alternatifleri aşağıda sorumlu hekim tarafından hastaya anlatılarak yazılır.",
    ],
    extra: [
      {
        heading: "İŞLEMİN ADI VE AÇIKLAMASI (hekim tarafından doldurulur)",
        lines: [
          "İşlemin adı: ______________________________________________",
          "Uygulanacak bölge / dişler: ______________________________",
          "İşlemin nasıl yapılacağı: ______________________________________________",
          "______________________________________________",
        ],
      },
    ],
    benefits: [
      "______________________________________________",
      "______________________________________________",
    ],
    risks: [
      "Lokal anestezi kullanılırsa geçici uyuşukluk, enjeksiyon yerinde hassasiyet; nadiren alerjik tepki",
      "İşlem sonrası ağrı, şişlik veya hassasiyet",
      "İşleme özgü riskler: ______________________________________________",
      "______________________________________________",
    ],
    alternatives: [
      "Alternatif tedaviler: ______________________________________________",
      "Tedavi yapılmazsa olası sonuçlar: ______________________________",
    ],
    aftercare: [
      "______________________________________________",
      "Beklenmedik ağrı, şişlik, kanama veya ateş olursa kliniği arayın",
    ],
  }),

  // ------------------------------------------------------------------ bilgilendirme
  "ISLEM-SONRASI": information({
    title: "İŞLEM SONRASI BAKIM VE KULLANIM BİLGİLENDİRMESİ",
    sections: [
      { heading: "YAPILAN İŞLEM", lines: ["{{plan.kalemler}}", "Ek açıklama: ______________________________________________"] },
      {
        heading: "İLK SAATLERDE",
        lines: bullets([
          "Uyuşukluk geçene kadar yemek yemeyin, sıcak içecek içmeyin; dudak, yanak ve dilinizi ısırmamaya dikkat edin",
          "Çocuklarda uyuşukluk süresince yakından gözetim gerekir",
          "Tampon verildiyse hekiminizin söylediği süre boyunca ısırarak tutun",
        ]),
      },
      {
        heading: "SONRAKİ GÜNLERDE",
        lines: bullets([
          "Birkaç gün süren hafif hassasiyet ve sıcak-soğuk duyarlılığı olağandır",
          "Dişlerinizi her zamanki gibi fırçalayın; işlem bölgesinde nazik olun",
          "İlaçları yalnızca hekiminizin önerdiği şekilde kullanın, kendi başınıza ilaç eklemeyin",
          "Geçici dolgu veya kaplama varsa o tarafla sert ve yapışkan yiyecek çiğnemeyin",
          "Isırmada yükseklik veya takılma hissi varsa kısa bir düzeltme randevusu alın",
        ]),
      },
      {
        heading: "KLİNİĞİ NE ZAMAN ARAMALISINIZ",
        lines: bullets([...CALL_CLINIC_COMMON, "Geçici dolgu, kaplama veya protez düşerse ya da kırılırsa"]),
      },
      { heading: "SONRAKİ RANDEVU", lines: ["Kontrol / devam randevusu: ____ . ____ . ________   Saat: ______"] },
    ],
  }),

  "CEKIM-SONRASI-BILGI": information({
    title: "ÇEKİM VE CERRAHİ SONRASI BAKIM BİLGİLENDİRMESİ",
    sections: [
      {
        heading: "İLK GÜN",
        lines: bullets([
          "Tamponu hekiminizin söylediği süre boyunca ısırarak tutun, sonra nazikçe çıkarın",
          "Tükürmeyin, ağzınızı sert çalkalamayın, pipetle içmeyin; oluşan pıhtı iyileşme için önemlidir",
          "Yüzünüze aralıklı olarak soğuk uygulayın",
          "Ilık veya soğuk, yumuşak besinler tüketin; işlem tarafıyla çiğnemeyin",
          "Sigara ve alkol kullanmayın; ağır egzersizden kaçının",
          "Başınızı biraz yüksekte tutarak dinlenin",
        ]),
      },
      {
        heading: "SONRAKİ GÜNLER",
        lines: bullets([
          "Dişlerinizi fırçalamaya devam edin, işlem bölgesine fırçayı değdirmeyin",
          "Hekiminiz önerdiyse ılık tuzlu su veya önerilen gargarayı nazikçe kullanın",
          "İlaçları yalnızca hekiminizin önerdiği şekilde kullanın",
          "Hafif şişlik ve morarma ilk günlerde artıp sonra azalabilir; bu olağandır",
          "Dikiş varsa alma randevusuna gelin; eriyen dikişler kendiliğinden düşebilir",
        ]),
      },
      {
        heading: "KLİNİĞİ NE ZAMAN ARAMALISINIZ",
        lines: bullets([
          ...CALL_CLINIC_COMMON,
          "Ağrı birkaç gün sonra azalmak yerine belirgin şekilde artarsa",
          "Dudak, çene veya dilde uyuşukluk işlem gününden sonra da sürerse",
          "Üst çene işlemlerinden sonra burundan sıvı gelmesi veya ağız ile burun arasında hava geçişi hissederseniz",
        ]),
      },
      { heading: "KONTROL RANDEVUSU", lines: ["Kontrol / dikiş alma: ____ . ____ . ________   Saat: ______"] },
    ],
  }),

  "IMPLANT-SONRASI-BILGI": information({
    title: "İMPLANT SONRASI BAKIM BİLGİLENDİRMESİ",
    sections: [
      {
        heading: "CERRAHİ SONRASI İLK GÜNLER",
        lines: bullets([
          "İlk gün yüzünüze aralıklı soğuk uygulayın, başınızı yüksekte tutarak dinlenin",
          "Tükürmeyin, sert çalkalamayın, pipet kullanmayın",
          "Yumuşak ve ılık besinler tüketin; implant bölgesiyle çiğnemeyin",
          "Sigara ve alkolden uzak durun; sigara iyileşmeyi ve kemikle kaynaşmayı olumsuz etkileyebilir",
          "İlaçları yalnızca hekiminizin önerdiği şekilde kullanın",
          "Hareketli protez kullanıyorsanız hekiminiz izin verene kadar takmayın veya düzeltilmeden kullanmayın",
        ]),
      },
      {
        heading: "İYİLEŞME DÖNEMİ",
        lines: bullets([
          "İmplantın kemikle kaynaşması zaman alır; bu süre kişiye göre değişir ve hekiminiz tarafından belirlenir",
          "İyileşme başlığı varsa yumuşak fırçayla nazikçe temizleyin",
          "Kontrol ve dikiş alma randevularına mutlaka gelin",
        ]),
      },
      {
        heading: "PROTEZ YAPILDIKTAN SONRA",
        lines: bullets([
          "İmplant çevresini her gün ara yüz fırçası, implant için uygun diş ipi veya ağız duşu ile temizleyin",
          "Gece diş sıkıyorsanız hekiminizin önereceği koruyucu plağı kullanın",
          "Yılda en az bir kez kontrol ve profesyonel temizlik yaptırın",
        ]),
      },
      {
        heading: "KLİNİĞİ NE ZAMAN ARAMALISINIZ",
        lines: bullets([...CALL_CLINIC_COMMON, "İmplant veya üstündeki parçada sallanma, ses ya da kırılma fark ederseniz", "İmplant çevresinde diş eti kanaması, akıntı veya şişlik olursa"]),
      },
    ],
  }),

  "PROTEZ-TESLIM-BILGI": information({
    title: "PROTEZ TESLİMİ VE YAPIŞTIRMA BİLGİLENDİRMESİ",
    sections: [
      { heading: "TESLİM EDİLEN PROTEZ", lines: ["{{plan.kalemler}}", "Protez türü / bölge: ______________________________"] },
      {
        heading: "SABİT PROTEZ (KRON, KÖPRÜ) İÇİN",
        lines: bullets([
          "Yapıştırma sonrası hekiminizin söylediği süre boyunca yemek yemeyin",
          "İlk günlerde sert ve yapışkan yiyeceklerden kaçının",
          "Köprü altını ve kaplama kenarlarını diş ipi geçirici, ara yüz fırçası veya ağız duşu ile temizleyin",
          "Geçici sıcak-soğuk hassasiyeti olabilir; birkaç hafta içinde geçmezse bildirin",
        ]),
      },
      {
        heading: "HAREKETLİ PROTEZ İÇİN",
        lines: bullets([
          "Alışma döneminde konuşma ve çiğnemede zorluk, tükürük artışı olağandır; yumuşak ve küçük lokmalarla başlayın",
          "Protezi her yemekten sonra çıkarıp yumuşak fırça ve uygun temizleyiciyle temizleyin; diş macunu yüzeyi çizebilir",
          "Hekiminiz başka bir öneride bulunmadıkça geceleri çıkarıp temiz bir kapta saklayın",
          "Yara veya baskı noktası oluşursa protezi kendiniz törpülemeyin; düzeltme için randevu alın",
          "Protezi sıcak suda yıkamayın, yere düşürmemek için lavabonun üstünde suyla dolu bir kapla temizleyin",
        ]),
      },
      {
        heading: "KLİNİĞİ NE ZAMAN ARAMALISINIZ",
        lines: bullets([
          "Kaplama veya köprü sallanır, düşer ya da kırılırsa",
          "Isırmada yükseklik veya ağrı varsa",
          "Hareketli protez yara yapar veya kırılırsa",
          "Diş etinde şişlik, akıntı veya geçmeyen ağrı olursa",
        ]),
      },
      { heading: "KONTROL", lines: ["Teslim sonrası kontrol randevusu: ____ . ____ . ________   Saat: ______"] },
    ],
  }),

  "ORTO-SONU-BILGI": information({
    title: "ORTODONTİK TEDAVİ SONU VE PEKİŞTİRME BİLGİLENDİRMESİ",
    sections: [
      {
        heading: "PEKİŞTİRME (RETANSİYON) NEDİR",
        lines: [
          "Aktif ortodontik tedavi bittikten sonra dişler ve çevre dokular yeni konuma uyum sağlamak için zamana ihtiyaç duyar. Bu dönemde dişler eski konumlarına dönme eğilimindedir.",
          "Pekiştirme aygıtları, dişlerin yeni konumunda kalmasına yardımcı olur. Dişler yaşam boyu hafifçe hareket edebildiği için pekiştirme uzun süreli bir sorumluluktur.",
        ],
      },
      {
        heading: "SİZE UYGULANAN PEKİŞTİRME",
        lines: [
          "[ ] Sabit (dişlerin arka yüzüne yapıştırılan) tel   Bölge: ______________",
          "[ ] Hareketli şeffaf pekiştirme plağı",
          "[ ] Hareketli telli pekiştirme apareyi",
          "Kullanım süresi ve şekli (hekim tarafından doldurulur): ______________________________",
        ],
      },
      {
        heading: "BAKIM VE KULLANIM",
        lines: bullets([
          "Hareketli aygıtı hekiminizin belirlediği süre boyunca takın; kullanmadığınızda kutusunda saklayın",
          "Aygıtı soğuk veya ılık suyla, yumuşak bir fırçayla temizleyin; sıcak suyla yıkamayın",
          "Sabit tel varsa çevresini diş ipi geçirici veya ara yüz fırçasıyla her gün temizleyin",
          "Sert yiyecekleri ön dişlerle ısırmaktan kaçının",
        ]),
      },
      {
        heading: "KLİNİĞİ NE ZAMAN ARAMALISINIZ",
        lines: bullets([
          "Sabit tel kopar, ayrılır veya batarsa",
          "Hareketli aygıt kırılır, kaybolur ya da artık oturmazsa",
          "Dişlerde aralanma veya kayma fark ederseniz",
        ]),
      },
      { heading: "KONTROL", lines: ["Pekiştirme kontrol randevusu: ____ . ____ . ________"] },
    ],
  }),

  // ------------------------------------------------------------------ kişisel veri / görsel izin
  "KVKK-AYDINLATMA": [
    DEMO_LINE,
    "",
    "{{klinik.ad}}",
    "KİŞİSEL VERİLERİN İŞLENMESİNE İLİŞKİN AYDINLATMA METNİ",
    "Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Tarih: {{belge.tarih}}",
    "",
    "VERİ SORUMLUSU",
    "Kişisel verileriniz, veri sorumlusu sıfatıyla {{klinik.ad}} tarafından aşağıda açıklanan çerçevede işlenmektedir.",
    "Adres: ______________________________________________",
    "İletişim (telefon / e-posta): ______________________________",
    "",
    "İŞLENEN KİŞİSEL VERİ KATEGORİLERİ",
    ...bullets([
      "Kimlik bilgileri: ad soyad, doğum tarihi, kimlik numarası",
      "İletişim bilgileri: telefon, e-posta, adres, acil durumda aranacak kişi",
      "Sağlık verileri: sağlık öyküsü, kullanılan ilaçlar, alerjiler, muayene bulguları, röntgen ve ağız içi fotoğraflar, tedavi ve reçete kayıtları",
      "Finansal bilgiler: ödeme, fatura ve varsa özel sigorta bilgileri",
    ]),
    "",
    "İŞLEME AMAÇLARI",
    ...bullets([
      "Muayene, teşhis ve tedavi hizmetlerinin planlanması ve yürütülmesi",
      "Hasta dosyasının ve tedavi kayıtlarının tutulması",
      "Randevu planlaması ve hatırlatma",
      "Faturalama, ödeme ve sigorta süreçlerinin yürütülmesi",
      "Mevzuattan doğan kayıt tutma ve bildirim yükümlülüklerinin yerine getirilmesi",
    ]),
    "",
    "HUKUKİ SEBEPLER",
    "Kişisel verileriniz genel olarak; kanunlarda açıkça öngörülmesi, sizinle kurulan hizmet ilişkisinin kurulması ve yürütülmesi, kliniğin hukuki yükümlülüklerini yerine getirmesi, bir hakkın kurulması veya korunması ve meşru menfaat sebeplerine dayanılarak işlenir. Sağlık verileriniz; tıbbi teşhis ve tedavi hizmetlerinin yürütülmesi amacıyla sır saklama yükümlülüğü altındaki kişilerce, ilgili mevzuatın öngördüğü hâllerde veya açık rızanızın bulunduğu durumlarda işlenir.",
    "",
    "VERİLERİN AKTARILABİLECEĞİ TARAFLAR",
    ...bullets([
      "Mevzuat gereği bilgi istemeye yetkili kamu kurumları",
      "Tedaviniz için çalışılan dental laboratuvarlar ve radyoloji veya patoloji merkezleri (yalnızca gerekli ölçüde)",
      "Talebiniz veya onayınız bulunması hâlinde özel sağlık sigortası şirketiniz",
      "Klinik yazılımı, kayıt ve barındırma gibi hizmetleri sağlayan iş ortakları (gizlilik yükümlülüğü altında)",
    ]),
    "",
    "SAKLAMA SÜRESİ",
    "Verileriniz, işleme amacının gerektirdiği ve ilgili mevzuatın öngördüğü süre boyunca saklanır; sürenin bitiminde silinir, yok edilir veya anonim hâle getirilir.",
    "",
    "HAKLARINIZ",
    ...bullets([
      "Verilerinizin işlenip işlenmediğini, hangi amaçla işlendiğini öğrenme ve bilgi talep etme",
      "Aktarıldığı üçüncü kişileri bilme",
      "Eksik veya yanlış işlenmişse düzeltilmesini, şartları oluştuğunda silinmesini isteme",
      "Otomatik sistemlerle analiz sonucu aleyhinize bir sonuç çıkmasına itiraz etme",
      "Hukuka aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme",
    ]),
    "",
    "BAŞVURU YÖNTEMİ",
    "Taleplerinizi kimliğinizi doğrulayan bilgilerle birlikte yazılı olarak klinik adresine veya yukarıdaki iletişim kanalına iletebilirsiniz.",
    "",
    "Bu metin bilgilendirme amaçlıdır; açık rıza yerine geçmez.",
    "",
    "Okudum, bilgilendirildim.",
    "Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________",
    "Tarih: {{belge.tarih}}",
  ].join("\n"),

  "GORSEL-IZIN": [
    DEMO_LINE,
    "",
    "{{klinik.ad}}",
    "GÖRSEL KAYIT VE KULLANIM İZNİ",
    "Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}",
    "Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}",
    "",
    "AÇIKLAMA",
    "Tedaviniz sırasında ağız içi ve yüz fotoğrafları, video kayıtları, röntgen ve dijital tarama görüntüleri alınabilir. Teşhis ve tedavi için gerekli görüntüler hasta dosyanızın parçasıdır. Aşağıdaki seçenekler, bu görüntülerin tedavi dışındaki kullanımları için ayrı ayrı izninizi sormaktadır.",
    "İzin vermemeniz tedavinizi hiçbir şekilde etkilemez.",
    "",
    "İZİN SEÇENEKLERİ (her satır için birini işaretleyiniz)",
    "1. Görüntülerimin yalnızca tedavi kaydı olarak hasta dosyamda saklanması ve tedavimle ilgili hekimler ve laboratuvarla paylaşılması",
    "   [ ] Evet   [ ] Hayır",
    "2. Kimliğim gizlenerek meslek içi eğitim, vaka tartışması ve bilimsel sunumlarda kullanılması",
    "   [ ] Evet   [ ] Hayır",
    "3. Yüzümün ve kimliğimin tanınamayacağı şekilde (yalnızca diş ve ağız içi görüntüler) kliniğin web sitesi, sosyal medya hesapları veya tanıtım materyallerinde anonim olarak yayımlanması",
    "   [ ] Evet   [ ] Hayır",
    "4. Yüzümün tanınabildiği fotoğraf veya videoların kliniğin tanıtımında kullanılması",
    "   [ ] Evet   [ ] Hayır",
    "",
    "KOŞULLAR",
    ...bullets([
      "Görüntüler adınız, dosya numaranız veya sizi tanıtabilecek başka bir bilgiyle birlikte yayımlanmaz (4. madde dışında)",
      "Verdiğiniz izni dilediğiniz zaman yazılı olarak geri alabilirsiniz",
      "Geri alma, geri alma tarihinden önce yapılmış basılı yayınları veya sunumları etkilemeyebilir; klinik tarafından yönetilen dijital yayınlardaki görüntüler makul sürede kaldırılır",
      "Görüntüler için size herhangi bir ücret ödenmez",
      "18 yaşından küçük hastalar için izin veli veya yasal vasi tarafından verilir",
    ]),
    "",
    "Yukarıdaki açıklamayı okudum; işaretlediğim seçenekler kendi isteğimdir.",
    "",
    "Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________",
    "(Yasal temsilci ise yakınlığı: ______________)",
    "Hekim: {{hekim.ad}}   İmza: __________",
    "Tarih: {{belge.tarih}}",
  ].join("\n"),

  // ------------------------------------------------------------------ idari / sigorta
  "HASTA-BILGI": [
    DEMO_LINE,
    "",
    "{{klinik.ad}}",
    "HASTA BİLGİ FORMU",
    "Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}",
    "Form tarihi: {{belge.tarih}}",
    "",
    "KİŞİSEL BİLGİLER",
    "Cinsiyet: [ ] Kadın  [ ] Erkek  [ ] Belirtmek istemiyorum",
    "Meslek: ______________________________",
    "",
    "İLETİŞİM BİLGİLERİ",
    "Cep telefonu: ______________________   Diğer telefon: ______________________",
    "E-posta: ______________________________",
    "Adres: ______________________________________________",
    "İl / ilçe: ______________________",
    "Tercih ettiğiniz iletişim yolu: [ ] Telefon  [ ] SMS  [ ] E-posta  [ ] Mesajlaşma uygulaması",
    "",
    "ACİL DURUMDA ARANACAK KİŞİ",
    "Adı soyadı: ______________________   Yakınlığı: ______________",
    "Telefon: ______________________",
    "",
    "VELİ / YASAL TEMSİLCİ (18 yaş altı veya temsil edilen hastalar için)",
    "Adı soyadı: ______________________   Yakınlığı: ______________",
    "Telefon: ______________________",
    "",
    "SAĞLIKLA İLGİLİ KISA BİLGİ",
    "Ayrıntılı sağlık öyküsü hekiminiz tarafından ayrıca alınacaktır.",
    "Kronik hastalık: ______________________________________________",
    "Sürekli kullanılan ilaçlar: ______________________________________________",
    "Alerji (ilaç, lateks, besin vb.): ______________________________________________",
    "",
    "KLİNİĞİMİZİ NEREDEN DUYDUNUZ",
    "[ ] Tavsiye (kimden: ______________)  [ ] İnternet arama  [ ] Sosyal medya  [ ] Tabela / yakın çevre  [ ] Diğer: ______________",
    "",
    "RANDEVU HATIRLATMA",
    "Randevu hatırlatmalarının yukarıdaki iletişim bilgilerime gönderilmesini istiyorum: [ ] Evet  [ ] Hayır",
    "",
    "BEYAN",
    "Bu formda verdiğim bilgilerin doğru olduğunu, değişiklik olması hâlinde kliniğe bildireceğimi beyan ederim.",
    "",
    "Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________",
    "Tarih: {{belge.tarih}}",
    "Formu teslim alan personel: ______________________",
  ].join("\n"),

  "ISTIRAHAT": [
    DEMO_LINE,
    "",
    "{{klinik.ad}}",
    "İSTİRAHAT / DURUM BELGESİ",
    "Belge tarihi: {{belge.tarih}}",
    "",
    "HASTA BİLGİLERİ",
    "Adı soyadı: {{hasta.ad_soyad}}",
    "Dosya no: {{hasta.dosya_no}}",
    "Doğum tarihi: {{hasta.dogum_tarihi}}",
    "",
    "DURUM",
    "Yukarıda bilgileri yazılı hasta, {{belge.tarih}} tarihinde kliniğimizde ağız ve diş sağlığı kapsamında muayene edilmiş ve/veya tedavi görmüştür.",
    "Klinikte bulunduğu saat aralığı: ______ - ______",
    "Yapılan muayene / işlem: ______________________________________________",
    "Gerekçe (hekim değerlendirmesi): ______________________________________________",
    "",
    "ÖNERİ (uygun olanı işaretleyiniz)",
    "[ ] Hekim değerlendirmesine göre ____ gün (____ - ____ tarihleri arasında) istirahat önerilmiştir.",
    "[ ] İstirahat önerilmemiştir; hasta yalnızca belirtilen saat aralığında klinikte bulunmuştur.",
    "[ ] Diğer: ______________________________________________",
    "",
    "AÇIKLAMA",
    "Bu belge, hastanın isteği üzerine, ilgili kişi veya kuruma sunulmak üzere düzenlenmiştir. Belgede yalnızca yukarıdaki tarihte yapılan muayene ve tedaviye ilişkin hekim değerlendirmesi yer alır; hastanın başka sağlık bilgileri paylaşılmamıştır.",
    "Belgenin üzerinde silinti veya kazıntı bulunması hâlinde doğrulama için kliniğe başvurulabilir.",
    "",
    "Hekim: {{hekim.ad}}",
    "Diploma / tescil no: ______________________",
    "İmza: __________   Kaşe: __________",
    "",
    "Klinik iletişim: ______________________________",
  ].join("\n"),

  "SIGORTA-BILGI": [
    DEMO_LINE,
    "",
    "{{klinik.ad}}",
    "ÖZEL SAĞLIK SİGORTASI BİLGİ FORMU",
    "Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}",
    "Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}",
    "",
    "SİGORTA BİLGİLERİ",
    "Sigorta şirketi: ______________________________",
    "Poliçe numarası: ______________________   Poliçe türü / planı: ______________",
    "Poliçe başlangıç - bitiş tarihi: ____ . ____ . ________  -  ____ . ____ . ________",
    "Sigortalının adı soyadı: ______________________",
    "Hastanın sigortalıya yakınlığı: [ ] Kendisi  [ ] Eşi  [ ] Çocuğu  [ ] Diğer: ______________",
    "Çalıştığı kurum (grup poliçesi ise): ______________________",
    "",
    "PLANLANAN TEDAVİLER",
    "{{plan.kalemler}}",
    "Ek açıklama: ______________________________________________",
    "",
    "PROVİZYON BİLGİLERİ (klinik tarafından doldurulur)",
    "Provizyon talep tarihi: ____ . ____ . ________   Talep eden personel: ______________",
    "Provizyon / onay numarası: ______________________",
    "Onaylanan işlemler ve tutar: ______________________________________________",
    "Hastanın ödeyeceği katılım payı / fark: ______________________",
    "Reddedilen veya kapsam dışı işlemler: ______________________________",
    "",
    "BİLGİLENDİRME",
    ...bullets([
      "Sigorta kapsamı, limitler ve katılım payı poliçe koşullarınıza göre sigorta şirketinizce belirlenir",
      "Sigorta şirketince karşılanmayan veya onaylanmayan tutarlar hastaya aittir; bu tutarlar tedavi öncesinde sizinle paylaşılır",
      "Provizyon sonucu çıkmadan başlanan tedavilerde ödeme sorumluluğu konusunda ayrıca bilgilendirilirsiniz",
    ]),
    "",
    "HASTANIN ONAYI",
    "Provizyon ve ödeme işlemlerinin yürütülebilmesi için; kimlik, poliçe ve tedavimle ilgili gerekli bilgilerin (teşhis, planlanan ve yapılan işlemler, gerekirse röntgen görüntüleri ve fatura bilgileri) {{klinik.ad}} tarafından yukarıda adı yazılı sigorta şirketiyle paylaşılmasına onay veriyorum. Bu onayı yazılı olarak geri alabileceğimi biliyorum; geri almam hâlinde sigorta işlemlerinin yürütülemeyebileceğini anladım.",
    "",
    "Hasta / sigortalı / yasal temsilci adı soyadı: ______________________   İmza: __________",
    "(Yasal temsilci ise yakınlığı: ______________)",
    "Formu düzenleyen personel: ______________________   İmza: __________",
    "Tarih: {{belge.tarih}}",
  ].join("\n"),
};

/** Standart DEMO şablon gövdesi; klinik çıktı türleri ve bilinmeyen kod için null. */
export function standardTemplateBody(code: string): string | null {
  return Object.prototype.hasOwnProperty.call(BODIES, code) ? BODIES[code]! : null;
}
