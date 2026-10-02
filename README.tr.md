# claviger

**Tarayıcın için açık kaynak iki adımlı doğrulama uygulaması.** claviger TOTP, HOTP ve Steam Guard kodlarını şifreli bir kasada üretir. Kasa, tarayıcı eşitlemesini sen açmadıkça cihazından çıkmaz.

[English](README.md)

> **Durum: erken geliştirme (0.x).** claviger henüz hiçbir tarayıcı mağazasında yayınlanmadı. 0.1.0 etiketlendi, ancak 1.0.0'a kadar yalnızca kaynak koddan kurulabilir. Uyumsuz değişiklikler olabilir; her zaman dışa aktarılmış bir yedeğin olsun.

## Özellikler

- **Şifreli kasa.** Her hesap AES-256-GCM ile şifrelenir. Anahtar, ana parolanla (Argon2id) ve istersen bir kurtarma koduyla korunur. Ayrıntılar: [docs/vault-format.md](docs/vault-format.md).
- **Ne zaman kilitleneceğini sen seçersin.** Seçenekler:
  - Tarayıcı kapanınca.
  - Tarayıcı kapanınca ya da ekran kilitlenince.
  - 15 dakika, 1 saat veya 4 saat kullanılmayınca.
  - Hiçbir zaman.

  Dışa aktarmak ve güvenlik ayarlarını değiştirmek her zaman parolayı yeniden ister; gizli anahtarı göstermek de, sen bunu kapatmadıkça parola ister.

- **Önce yerel.** Kasa varsayılan olarak tarayıcının yerel deposunda durur. Tarayıcı eşitlemesi isteğe bağlıdır ve oraya yalnızca şifreli veri yazılır.
- **Siteyi tanır.** Hesaplar ait oldukları sitelere bağlanabilir; doğru kod en üstte görünür. Açılır pencere, her sitede hangi hesabı kullandığını hatırlar ve ona göre sıralar.
- **İstek üzerine doldurma.** Açılır penceredeki _Doldur_ düğmesi, Alt+Shift+O kısayolu veya sağ tık "Insert 2FA code" menüsü kodu açık sayfaya yazar. Yalnızca o siteye bağlı hesapları, yalnızca https sayfalarında doldurur; yazmadan hemen önce sayfayı yeniden denetler ve gizli anahtarı sayfaya vermez.
- **QR kodlar.** Ekrandan QR kod tara (dondurulmuş görüntü, otomatik algılama veya alan seçimi) ya da bir resim dosyasından içe aktar. Çözme işlemi yerelde yapılır.
- **Otomatik yerel kopyalar.** Bu cihazda her gün ve riskli değişikliklerden önce şifreli kopya alınır; son 7 tanesi saklanır. Geri yükleme yalnızca eksik hesapları ekler. Kasa boşsa geri yükleme önerilir; bozuk kasa silinmeden kenara alınabilir. Parola veya kurtarma kodu değişince bu kopyalar da yeniden anahtarlanır.
- **Görünüm ve pano.** Normal, Kompakt ve Gizli görünüm modları. İstersen kod kopyalandıktan 30 sn veya 1 dk sonra pano temizlenir. Kurtarma kodunun saklandığı hiç onaylanmadıysa hatırlatma çıkar.
- **Düzenleme.** Hesapları sürükle-bırak ile sırala; aynı adlı hesap eklerken uyarı gösterilir.
- **İsteğe bağlı saat kontrolü.** Saatini tek bir HTTPS kaynağıyla (`www.google.com`) karşılaştırır. Varsayılan olarak kapalıdır; tarayıcı bu izni yalnızca o istek için sorar.
- **İçe aktarma.** Google Authenticator, Authenticator eklentisi, Aegis, 2FAS ve düz `otpauth://` bağlantıları desteklenir. Neyin ekleneceği önce önizlemede gösterilir; zaten kayıtlı hesaplar kopyalanmaz.
- **Yedekleme.** Önerilen yol şifreli `.claviger` dosyasıdır. Başka bir uygulamaya geçmek için düz `otpauth://` listesi de alınabilir.
- **Chrome ve Firefox** (Manifest V3; Chrome 116+, Firefox 140+). Yalnızca gereken izinler istenir; uzaktan kod, yazı tipi ya da analitik yoktur.

İsteğe bağlı saat kontrolü dışında (`www.google.com`'a bağlanır) hiçbir şey cihazından çıkmaz. Sürüm politikası: [docs/versioning.md](docs/versioning.md).

## İzinler

- `storage`: şifreli kasayı, kopyaları ve ayarları saklamak.
- `alarms` ve `idle`: kilit zamanlayıcıları ve günlük yerel kopyalar.
- `activeTab` ve `scripting`: kodu açık sayfaya yazmak; yalnızca sen istediğinde.
- `clipboardWrite`: kodları kopyalamak.
- `contextMenus`: sağ tık "Insert 2FA code" girişi.
- `offscreen` (yalnızca Chrome): seçtiğin süre dolunca panoyu temizleyen kısa ömürlü gizli bir sayfa; arka plan servisinin panoya erişimi yoktur.
- İsteğe bağlı `www.google.com`: yalnızca saat kontrolü için istenir.

## Kaynak koddan derleme

Gerekenler: Node.js 22+ ve pnpm 10.

```sh
pnpm install
pnpm --filter @claviger/extension build          # Chrome  → apps/extension/.output/chrome-mv3
pnpm --filter @claviger/extension build:firefox  # Firefox → apps/extension/.output/firefox-mv3
```

- **Chrome:** `chrome://extensions` sayfasında *Geliştirici modu*nu aç, _Paketlenmemiş öğe yükle_'yi seç ve `apps/extension/.output/chrome-mv3` klasörünü göster.
- **Firefox:** `about:debugging#/runtime/this-firefox` sayfasında _Geçici Eklenti Yükle_'yi seç ve `apps/extension/.output/firefox-mv3` içindeki herhangi bir dosyayı göster.

## Katkı ve güvenlik

- Pull request açmadan önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını oku.
- **Güvenlik sorunlarını herkese açık issue olarak bildirme.** Nasıl bildireceğin [SECURITY.md](SECURITY.md) dosyasında.
- Bu proje [Davranış Kuralları](CODE_OF_CONDUCT.md)'na uyar.

## Teşekkür

claviger, [Authenticator-Extension/Authenticator](https://github.com/Authenticator-Extension/Authenticator) projesinden ilham alır. Ekibine ve katkıda bulunanlara teşekkürler. Üçüncü taraf bileşenler: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Lisans

[MIT](LICENSE)
