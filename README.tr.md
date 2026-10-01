# otp-vault

**Tarayıcın için açık kaynak iki adımlı doğrulama uygulaması.** otp-vault TOTP, HOTP ve Steam Guard kodlarını şifreli bir kasada üretir. Kasa, tarayıcı eşitlemesini sen açmadıkça cihazından çıkmaz.

[English](README.md)

> **Durum: erken geliştirme (0.x).** otp-vault henüz hiçbir tarayıcı mağazasında yayınlanmadı. 1.0.0'a kadar yalnızca kaynak koddan kurulabilir. Uyumsuz değişiklikler olabilir; her zaman dışa aktarılmış bir yedeğin olsun.

## Özellikler

- **Şifreli kasa.** Her hesap AES-256-GCM ile şifrelenir. Anahtar, ana parolanla (Argon2id) ve istersen bir kurtarma koduyla korunur. Ayrıntılar: [docs/vault-format.md](docs/vault-format.md).
- **Ne zaman kilitleneceğini sen seçersin.** Seçenekler:
  - Tarayıcı kapanınca.
  - Tarayıcı kapanınca ya da ekran kilitlenince.
  - 15 dakika, 1 saat veya 4 saat kullanılmayınca.
  - Hiçbir zaman.

  Gizli anahtarı göstermek, dışa aktarmak ve güvenlik ayarlarını değiştirmek her zaman parolayı yeniden ister.

- **Önce yerel.** Kasa varsayılan olarak tarayıcının yerel deposunda durur. Tarayıcı eşitlemesi isteğe bağlıdır ve oraya yalnızca şifreli veri yazılır.
- **Siteyi tanır.** Hesaplar ait oldukları sitelere bağlanabilir; doğru kod en üstte görünür.
- **İçe aktarma.** Google Authenticator, Authenticator eklentisi, Aegis, 2FAS ve düz `otpauth://` bağlantıları desteklenir. Neyin ekleneceği önce önizlemede gösterilir; zaten kayıtlı hesaplar kopyalanmaz.
- **Yedekleme.** Önerilen yol şifreli `.otpvault` dosyasıdır. Başka bir uygulamaya geçmek için düz `otpauth://` listesi de alınabilir.
- **Chrome ve Firefox** (Manifest V3). Yalnızca gereken izinler istenir; uzaktan kod, yazı tipi ya da analitik yoktur.

Sonraki 0.x sürümleri için planlananlar: ekrandan QR tarama, istek üzerine otomatik doldurma, saat kayması kontrolü ve otomatik yerel yedekler. Sürüm politikası: [docs/versioning.md](docs/versioning.md).

## Kaynak koddan derleme

Gerekenler: Node.js 22+ ve pnpm 10.

```sh
pnpm install
pnpm --filter @otp-vault/extension build          # Chrome  → apps/extension/.output/chrome-mv3
pnpm --filter @otp-vault/extension build:firefox  # Firefox → apps/extension/.output/firefox-mv3
```

- **Chrome:** `chrome://extensions` sayfasında *Geliştirici modu*nu aç, _Paketlenmemiş öğe yükle_'yi seç ve `apps/extension/.output/chrome-mv3` klasörünü göster.
- **Firefox:** `about:debugging#/runtime/this-firefox` sayfasında _Geçici Eklenti Yükle_'yi seç ve `apps/extension/.output/firefox-mv3` içindeki herhangi bir dosyayı göster.

## Katkı ve güvenlik

- Pull request açmadan önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını oku.
- **Güvenlik sorunlarını herkese açık issue olarak bildirme.** Nasıl bildireceğin [SECURITY.md](SECURITY.md) dosyasında.
- Bu proje [Davranış Kuralları](CODE_OF_CONDUCT.md)'na uyar.

## Teşekkür

otp-vault, [Authenticator-Extension/Authenticator](https://github.com/Authenticator-Extension/Authenticator) projesinden ilham alır. Ekibine ve katkıda bulunanlara teşekkürler. Üçüncü taraf bileşenler: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Lisans

[MIT](LICENSE)
