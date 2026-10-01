# Sürüm stratejisi

otp-vault [Semantic Versioning](https://semver.org/lang/tr/) (`MAJOR.MINOR.PATCH`) kullanır.

## 1.0.0'dan önce: `0.y.z`

| Değişiklik                                                    | Artan                | Örnek         |
| ------------------------------------------------------------- | -------------------- | ------------- |
| Hata düzeltmesi veya kullanıcıya görünmeyen küçük iyileştirme | `z`                  | 0.1.0 → 0.1.1 |
| Yeni özellik veya göze çarpan davranış değişikliği            | `y` (`z` sıfırlanır) | 0.1.1 → 0.2.0 |

- 1.0.0'dan önce mağazalara (Chrome Web Store, Firefox Add-ons, Edge) **yayın yapılmaz**. Kurulum GitHub sürümlerinden, elle yapılır.
- **1.0.0 = mağazalarda ilk yayın (lansman).**

### Yol haritası eşlemesi

| Sürüm  | İçerik                                                                                      |
| ------ | ------------------------------------------------------------------------------------------- |
| 0.0.1  | Plan 1–3: çekirdek, eklenti temeli, arayüz (geliştirici modunda çalışır)                    |
| 0.1.0  | Plan 4: QR tarama, otomatik doldurma, saat kontrolü, otomatik yerel yedekler, paketleme     |
| 0.2.0+ | Geri bildirim ve upstream analizinden gelen özellikler (`docs/research/upstream-issues.md`) |
| 1.0.0  | Mağaza lansmanı                                                                             |

## 1.0.0'dan sonra: katı SemVer

- **MAJOR:** kullanıcıyı kıran değişiklik. Örnekler: bir tarayıcı sürümüne desteği bırakmak, eski bir yedek biçimini artık açamamak.
- **MINOR:** geriye uyumlu yeni özellik.
- **PATCH:** geriye uyumlu hata düzeltmesi.

## Kurallar

1. **Mağaza biçimi.** Manifest sürümü yalnızca rakam ve noktadan oluşur (en fazla 4 parça, her biri 0–65535). `-beta` gibi ekler kullanılamaz. Her yükleme bir öncekinden büyük olmalıdır. Bir sürümü geri almak da yeni bir numarayla yapılır. Test sürümleri gerekirse dördüncü parça kullanılır (`1.2.0.1`).
2. **Tek sürüm numarası.** Repodaki her paket aynı sürümü taşır. Bu paketler: kök, `@otp-vault/core` ve `@otp-vault/extension`. Git etiketi `vX.Y.Z` biçimindedir. `@otp-vault/core` npm'e yayımlanmaz. Masaüstü uygulaması geldiğinde ayrı numara gerekip gerekmediği yeniden değerlendirilir.
3. **Tek kaynak.** Manifest sürümü `apps/extension/package.json`'dan okunur; elle ikinci bir yerde yazılmaz (Plan 4'te bağlanır).
4. **Veri biçimleri ayrı sürümlenir.** Uygulama sürümünden bağımsız tam sayılardır: kasa başlığındaki `format`, `.otpvault` dışa aktarma biçimi ve kayıt sürümü `v`. Bu numaraları artıran her uygulama sürümü eski veriyi otomatik ve kayıpsız taşımak zorundadır. Daha yeni biçimdeki veriye dokunulmaz (`unsupported-format`).
5. **Commit'ler ve değişiklik günlüğü.** Commit mesajları Conventional Commits biçimindedir (`feat:`, `fix:`, `docs:` …). Plan 4'te release-please kurulur. Bu araç sürüm numarasını commit'lerden önerir ve `CHANGELOG.md` dosyasını yazar. O zamana kadar sürüm elle artırılır.
