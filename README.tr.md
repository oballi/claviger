# claviger

**Chrome ve Firefox için açık kaynak iki adımlı doğrulama uygulaması.** claviger TOTP, HOTP ve Steam Guard kodlarını kendi cihazındaki şifreli bir kasada tutar; bir site kod istediğinde doğru kodu önüne getirir.

[English](README.md)

<p align="center">
  <img src="docs/media/claviger-tr.gif" alt="claviger, Alt+Shift+O ile bir giriş sayfasına iki adımlı doğrulama kodunu dolduruyor" width="800">
</p>

> **Durum: 1.0.** Tarayıcı mağazası sayfaları hazırlanıyor; yayına girene kadar claviger'ı [Releases](https://github.com/oballi/claviger/releases/latest) sayfasından indirebilirsin (aşağıya bak). Her durumda dışa aktarılmış bir yedeğin olsun.

## Özellikler

### Kodların, gereken yerde

- Her biri için geri sayımlı TOTP, HOTP ve Steam Guard kodları.
- **Bu site:** bir siteye bağladığın hesaplar, o sitedeyken en üstte görünür. Adlardan tahmin yapılmaz.
- **İstediğinde doldurma:** bir kısayola bas (varsayılan Alt+Shift+O) ya da kod kutusuna sağ tıklayıp "claviger ile doldur"u seç. Yalnızca sayfanın sitesine bağlı hesapları, yalnızca https sayfalarda doldurur ve yazmadan hemen önce sayfayı yeniden kontrol eder.
- **Hesap ekleme:** ekrandaki QR kodu tarayarak, bir görsel dosyasından, bir görseli yapıştırarak (Ctrl+V) ya da kurulum anahtarını yazarak.
- **Düzen:** gruplar, sabitlenmiş hesaplar, arama ve sürükle-bırak ile sıralama modu.
- **Sana göre görünüm:** claviger'ı popup (küçük, orta ya da büyük), ayrı pencere ya da yan panel olarak aç. Normal, Kompakt ya da Gizli görünüm; Gizli görünümde göz düğmesi bir kodu 10 saniye gösterir. Açık, koyu ya da sistem teması; Türkçe ya da İngilizce.

### Güvenlik

- Her hesap AES-256-GCM ile şifrelenir. Anahtar, ana parolanla (Argon2id) ve istersen bir kurtarma koduyla korunur. Ayrıntılar: [docs/vault-format.md](docs/vault-format.md).
- Ne zaman kilitleneceğini sen seçersin: tarayıcı kapanınca, ekran kilitlenince, 15 dakika, 1 saat ya da 4 saat işlem yapılmayınca, ya da hiçbir zaman. Kasayı anında kilitleyen bir klavye kısayolu da atayabilirsin.
- Dışa aktarma ve güvenlik ayarlarını değiştirme parolayı yeniden ister; gizli anahtarı göstermek de, sen kapatmadıkça ister. Kilit ayarları da kasa anahtarıyla mühürlenir, böylece senden habersiz değiştirilemez.
- Pano, bir kodu kopyaladıktan 1 dakika sonra temizlenir (30 saniye ya da hiçbir zaman da seçilebilir).
- Silinen hesaplar 30 gün **Son silinenler**'de kalır. Kasanın şifreli kopyaları her gün ve riskli değişikliklerden önce bu cihazda alınır (son 7 kopya tutulur).

### Taşıma ve yedek

- **İçe aktarma:** Google Authenticator, Authenticator eklentisi, Aegis, 2FAS, Proton Authenticator, Bitwarden, andOTP, FreeOTP+, Stratum (Authenticator Pro), Raivo ve düz `otpauth://` bağlantıları. Aegis, 2FAS, Proton, andOTP, Stratum ve Authenticator eklentisinin şifreli yedekleri de okunur. Kaydetmeden önce tam olarak neyin ekleneceğini görürsün.
- **Kopya hesapları bul** ve birleştir, istersen geri al.
- **Dışa aktarma:** şifreli `.claviger` yedeği (önerilen), Aegis uyumlu dosya (şifreli ya da düz) ya da düz `otpauth://` listesi.
- **Telefona taşıma:** bir hesabı QR kod olarak ya da birden çok hesabı Google Authenticator aktarım QR'ları olarak göster. Kısa süre sonra kendiliğinden gizlenirler.
- Bir süredir yedek almadıysan (varsayılan 30 gün) küçük bir hatırlatma çıkar.

## Gizlilik

claviger'ın hesabı, sunucusu ya da analitiği yok. Kasa, tarayıcı eşitlemesini açmadıkça tarayıcının yerel depolamasında kalır; açsan bile yalnızca şifreli veri eşitlenir. Tek ağ isteği, senin başlattığın isteğe bağlı saat kontrolüdür ve `www.google.com`'a bir kez bağlanır. Uzaktan kod ya da yazı tipi yüklenmez.

## İzinler

| İzin                            | Neden                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `storage`                       | Şifreli kasayı, yerel kopyaları ve ayarları tutmak.                               |
| `alarms`, `idle`                | Kilit zamanlayıcıları, ekran kilidini algılama ve günlük yerel kopyalar.          |
| `activeTab`, `scripting`        | Yalnızca sen istediğinde açık sayfaya kod yazmak.                                 |
| `clipboardWrite`                | Kod kopyalamak.                                                                   |
| `contextMenus`                  | Sağ tık menüsündeki "claviger ile doldur".                                        |
| `offscreen` (Chrome)            | Seçtiğin süre sonunda panoyu temizlemek; arka plan servisinin panoya erişimi yok. |
| `sidePanel` (Chrome)            | O açılış biçimini seçersen claviger'ı yan panelde göstermek.                      |
| `www.google.com` (isteğe bağlı) | Yalnızca saat kontrolünü çalıştırdığında istenir.                                 |

## Sürüm paketinden kurulum

Tarayıcına uygun dosyaları [son sürüm](https://github.com/oballi/claviger/releases/latest) sayfasından indir.

- **Chrome, Edge, Brave (116+):** `claviger-<sürüm>-chrome.zip` dosyasını indir ve silmeyeceğin bir klasöre aç (tarayıcı eklentiyi oradan yükler). `chrome://extensions` sayfasını aç, _Geliştirici modu_'nu aç, _Paketlenmemiş öğe yükle_'yi seç ve o klasörü göster. Klasörün yerini değiştirme: eklentinin verileri bu klasöre bağlıdır.
- **Firefox (140+):** eklenti addons.mozilla.org'da imzalanana kadar Firefox onu yalnızca geçici eklenti olarak kabul eder; Firefox kapanınca kaldırılır. `claviger-<sürüm>-firefox.zip` dosyasını indir, `about:debugging#/runtime/this-firefox` sayfasını aç, _Geçici Eklenti Yükle_'yi seç ve zip dosyasını göster.

Sürümdeki `SHA256SUMS.txt` dosyası, dosyaların sağlama toplamlarını listeler.

## Kaynaktan kurulum

Node.js 22+ ve pnpm 10 gerekir.

```sh
pnpm install
pnpm --filter @claviger/extension build          # Chrome  → apps/extension/.output/chrome-mv3
pnpm --filter @claviger/extension build:firefox  # Firefox → apps/extension/.output/firefox-mv3
```

- **Chrome (116+):** `chrome://extensions` sayfasını aç, _Geliştirici modu_'nu aç, _Paketlenmemiş öğe yükle_'yi seç ve `apps/extension/.output/chrome-mv3` klasörünü göster.
- **Firefox (140+):** `about:debugging#/runtime/this-firefox` sayfasını aç, _Geçici Eklenti Yükle_'yi seç ve `apps/extension/.output/firefox-mv3` içindeki herhangi bir dosyayı göster.

Firefox paketini bir kaynak arşivinden birebir yeniden üretmek için [docs/build-from-source.md](docs/build-from-source.md) belgesine bak. Sürüm politikası: [docs/versioning.md](docs/versioning.md).

## Proje yapısı

| Yol              | Ne                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/core`  | Platformdan bağımsız TypeScript: OTP algoritmaları, şifreli kasa, içe ve dışa aktarma. Tarayıcı API'si kullanmaz. |
| `packages/ui`    | Ortak React arayüzü (popup ve yönetim sayfaları) ve mesaj sözleşmesi.                                             |
| `apps/extension` | Tarayıcı eklentisi (WXT): arka plan servisi, tarayıcı entegrasyonu ve testler.                                    |

## Katkı ve güvenlik

- Pull request açmadan önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını oku. Çeviriler için: [docs/i18n.md](docs/i18n.md).
- **Güvenlik sorunlarını lütfen herkese açık issue'larda bildirme.** Bkz. [SECURITY.md](SECURITY.md).
- claviger'ın ne sakladığı ve ne gönderdiği: [PRIVACY.tr.md](PRIVACY.tr.md) (gizlilik politikası).
- Bu proje [Davranış Kuralları](CODE_OF_CONDUCT.md)'na uyar.

## Teşekkür

claviger, [Authenticator-Extension/Authenticator](https://github.com/Authenticator-Extension/Authenticator) projesinden ilham alır; bakımcılarına ve katkıcılarına teşekkürler. Üçüncü taraf bileşenler [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) dosyasında listelenir.

## Lisans

[MIT](LICENSE)
