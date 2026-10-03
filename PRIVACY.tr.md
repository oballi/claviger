# Gizlilik politikası

[English](PRIVACY.md)

Son güncelleme: 3 Ekim 2026. Chrome ve Firefox için claviger tarayıcı eklentisinin 1.0 ve sonraki sürümleri için geçerlidir.

claviger kişisel veri toplamaz, iletmez, satmaz ve paylaşmaz. Analitik, izleme, kullanıcı hesabı ya da kendine ait bir sunucusu yoktur. Geliştiriciler hesaplarını, kodlarını, parolalarını ya da eklentiyi nasıl kullandığını göremez.

## Neler, nerede saklanır

claviger'ın sakladığı her şey, cihazındaki tarayıcının eklenti depolamasında durur.

- **Kasa:** hesapların (hizmet adı, hesap adı, gizli anahtar, kod ayarları, bağlı siteler), sıraları, sabitlenenler ve gruplar. Her hesap ve sıra listesi AES-256-GCM ile şifrelenir. Şifreleme anahtarını ana parolan (Argon2id) ve oluşturduysan bir kurtarma kodu korur. Parolan hiçbir yerde saklanmaz. Şifresiz başlıkta yalnızca kasa kimliği, anahtar türetme ayarları ve şifrelenmiş (sarılmış) anahtarlar bulunur. Biçim [docs/vault-format.md](docs/vault-format.md) dosyasında belgelenmiştir.
- **Silme işaretleri:** bir hesabı sildiğinde, hesabın rastgele kimliğini ve silinme zamanını içeren küçük, şifresiz bir işaret 90 gün tutulur; böylece tarayıcı senkronizasyonu kullanıyorsan silme işlemi diğer cihazlarına da ulaşır. Hesap verisi içermez.
- **Son silinenler:** silinen hesaplar, silmeyi geri alabilmen için 30 gün boyunca bu cihazda şifreli olarak tutulur. Hiçbir zaman eşitlenmez.
- **Otomatik kopyalar:** kasanın her gün ve riskli değişikliklerden önce alınan şifreli kopyaları; son 7 tanesi tutulur. Bu cihazda kalır ve kasa gibi korunur.
- **Ayarlar:** tema, dil, görünüm, açılış biçimi, kilit ve pano ayarları, yedek hatırlatma tarihleri ve saat düzeltmesi. Kilit ayarların ayrıca kasa anahtarıyla mühürlenir. Ayarlar bu cihazda kalır, hiçbir zaman eşitlenmez.
- **Açık kasanın anahtarı:** kasa açıkken anahtarı tarayıcının oturum depolamasında durur; bu depolama bellekte tutulur ve kasa kilitlenince ya da tarayıcı kapanınca silinir. "Hiçbir zaman" kilit ayarını seçersen anahtar diske de yazılır ve bilgisayarına erişen herkes kodlarını görebilir.

## Tarayıcı senkronizasyonu (isteğe bağlı, varsayılan kapalı)

claviger'ı kurarken ya da sonra Yedekleme sayfasında "Yalnızca bu cihaz" yerine "Tarayıcı senkronizasyonu"nu seçebilirsin. Bu seçenekte kasa (şifreli hesaplar ve sıra listesi, sarılmış anahtarları içeren başlık ve silme işaretleri) tarayıcının eşitleme depolamasına yazılır. Tarayıcın onu aynı tarayıcı hesabıyla oturum açtığın diğer cihazlarına kopyalar; tarayıcı sağlayıcısı (örneğin Google veya Mozilla) bu veriyi kendi gizlilik politikasına göre saklar ve aktarır.

Yalnızca kasa eşitlenir. Hesap adları, gizli anahtarlar, gruplar ve siteler cihazdan çıkmadan önce şifrelenir; parolan, açık kasanın anahtarı, ayarlar, otomatik kopyalar ve son silinen hesaplar eşitleme depolamasına hiçbir zaman yazılmaz. "Yalnızca bu cihaz"a geri döndüğünde kasa bu cihaza taşınır ve eşitleme depolamasından silinir.

## Ağ istekleri

claviger uzaktan kod, betik ya da yazı tipi yüklemez ve geliştiricilerine hiçbir şey göndermez.

Yapabileceği tek ağ isteği, Tercihler sayfasındaki isteğe bağlı **saat kontrolüdür**. Bilgisayarının saati yanlış olduğu için kodlar reddediliyorsa bunu sen başlatırsın:

1. Tarayıcı, bu kontrol için `www.google.com` adresine erişim izni ister. Reddedersen hiçbir şey gönderilmez.
2. claviger, `https://www.google.com/generate_204` adresine çerezsiz ve yönlendiren (referrer) bilgisi olmadan tek bir `HEAD` isteği gönderir ve yanıttan yalnızca `Date` başlığındaki saati okur.
3. İzin, kontrolden hemen sonra kaldırılır.

İstek hesap verisi içermez. Her web isteği gibi Google'ın sunucusuna senin IP adresinden ve tarayıcının standart başlıklarıyla ulaşır; Google bu isteği kendi gizlilik politikasına göre işler.

## Web sayfaları

- **Bu site:** claviger'ı açtığında, o siteye bağladığın hesapları göstermek için geçerli sekmenin adresini okur. Adres yalnızca cihazda kullanılır; saklanmaz ve gönderilmez.
- **Kod doldurma:** sen istediğinde (Alt+Shift+O kısayolu, sağ tıktaki "claviger ile doldur" ya da açılır pencerede Shift+Enter), claviger geçerli sekmeye tek kullanımlık kodu kod alanına yazan küçük bir işlev ekler. Bunu yalnızca o siteye bağladığın bir hesap için, yalnızca https sayfalarında (düz http yalnızca `localhost` gibi yerel adreslerde) yapar ve gizli anahtarı sayfaya hiçbir zaman vermez. claviger web sayfalarında kalıcı betik çalıştırmaz.
- **Ekrandan QR kodu tarama:** taramayı başlattıktan sonra claviger geçerli sekmenin görünen kısmının görüntüsünü alır. Görüntü cihazında çözülür, en fazla 60 saniye bellekte tutulur; hiçbir zaman saklanmaz ve gönderilmez.

## Pano

Bir kodu kopyaladığında claviger onu panoya yazar. Varsayılan olarak 1 dakika sonra (30 saniye ya da hiçbir zaman da seçilebilir) panoya boş bir değer yazarak panoyu temizler; bu sürede başka bir şey kopyaladıysan o da silinir. claviger panonu hiçbir zaman okumaz. Hesap eklemek için Ctrl+V ile kendin yapıştırdığın bir QR görseli yalnızca o yapıştırmadan okunur ve cihazında çözülür.

## Dışa aktarma ve yedekler

Şifreli `.claviger` yedekleri ve şifreli Aegis dışa aktarımları senin seçtiğin bir parolayla korunur. Düz `otpauth://` listesi ve düz Aegis dışa aktarımı şifrelenmez; nereye kaydedeceğine sen karar verirsin. Telefona aktarma QR kodları yalnızca ekranda gösterilir ve kısa bir süre sonra kendiliğinden gizlenir.

## İzinler

| İzin                            | Neden                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `storage`                       | Şifreli kasayı, yerel kopyaları ve ayarları tutmak.                                                                     |
| `alarms`, `idle`                | Kilit zamanlayıcıları, ekran kilidini algılama, günlük yerel kopyalar ve pano zamanlayıcısı.                            |
| `activeTab`, `scripting`        | Yalnızca senin işleminden sonra geçerli sekmenin adresini okumak ve koda doldurmak; QR taraması için görüntüsünü almak. |
| `clipboardWrite`                | Kodları kopyalamak ve yeniden temizlemek.                                                                               |
| `contextMenus`                  | Sağ tıktaki "claviger ile doldur" öğesi.                                                                                |
| `offscreen` (Chrome)            | Panoyu seçtiğin süre sonunda temizlemek; arka plan hizmetinin panoya erişimi yoktur.                                    |
| `sidePanel` (Chrome)            | Bu açılış biçimini seçtiğinde claviger'ı yan panelde göstermek.                                                         |
| `www.google.com` (isteğe bağlı) | Yalnızca saat kontrolünü çalıştırdığında istenir ve kontrolden sonra kaldırılır.                                        |

## Çocuklar

claviger genel amaçlı bir araçtır ve çocuklar dahil hiç kimseden bilerek veri toplamaz.

## İletişim

claviger, MIT lisanslı açık kaynak bir projedir: <https://github.com/oballi/claviger>.

- Bu politika hakkındaki sorular: <https://github.com/oballi/claviger/issues> adresinde bir issue aç.
- Güvenlik sorunları: lütfen herkese açık issue yerine deponun **Security** sekmesinden ("Report a vulnerability") özel olarak bildir. Bkz. [SECURITY.md](SECURITY.md).

## Değişiklikler

Bu politika değişirse yeni sürüm bu dosyada yayımlanır ve yukarıdaki tarih güncellenir. Dosyanın geçmişi her değişikliği gösterir.

Bu çeviri bilgi amaçlıdır; iki metin arasında fark olursa İngilizce metin ([PRIVACY.md](PRIVACY.md)) geçerlidir.
