import { useCallback } from "react";
import { useLocale, useT, type MessageKey } from "@claviger/ui";

// Kept out of the shared dictionaries so the popup bundle does not carry the scan page's strings.
const tr = {
  "scan.title": "QR tara.",
  "scan.expired": "Görüntünün süresi doldu; taramayı tekrar başlat.",
  "scan.scanning": "Görüntü taranıyor…",
  "scan.failed": "Görüntü taranamadı.",
  "scan.cropNone": "Bu alanda QR bulunamadı.",
  "scan.frame": "Yakalanan ekran görüntüsü, QR seçim alanı",
  "scan.imageAlt": "Yakalanan ekran görüntüsü",
  "scan.draw": "QR'ın çevresine bir kutu çiz.",
  "scan.scanSelection": "Seçili alanı tara",
  "scan.rescanAll": "Bütün görüntüyü tekrar tara",
  "scan.selectArea": "Alan seçerek tara",
  "scan.found": "Bu görüntüde {count} QR bulundu",
  "scan.foundOne": "Bir QR bulundu.",
  "scan.add": "Ekle",
  "scan.preview": "Önizle ve içe aktar",
  "scan.added": "{name} eklendi",
  "scan.migrationName": "Çok hesaplı dışa aktarım",
  "scan.sourceName": "Ekran görüntüsü",
  "scan.done": "Eklendi. Bu sekmeyi kapatabilirsin.",
  "scan.locked": "Kasa kilitlendi; taramayı tekrar başlat.",
  "scan.finish": "Bitti",
} as const;

export type ScanKey = keyof typeof tr;

const en: Record<ScanKey, string> = {
  "scan.title": "Scan a QR code.",
  "scan.expired": "The image has expired; start the scan again.",
  "scan.scanning": "Scanning the image…",
  "scan.failed": "The image could not be scanned.",
  "scan.cropNone": "No QR code found in this area.",
  "scan.frame": "Captured screenshot, QR selection area",
  "scan.imageAlt": "Captured screenshot",
  "scan.draw": "Draw a box around the QR code.",
  "scan.scanSelection": "Scan selected area",
  "scan.rescanAll": "Scan the whole image again",
  "scan.selectArea": "Scan by selecting an area",
  "scan.found": "{count} QR codes found in this image",
  "scan.foundOne": "Found one QR code.",
  "scan.add": "Add",
  "scan.preview": "Preview and import",
  "scan.added": "{name} added",
  "scan.migrationName": "Multi-account export",
  "scan.sourceName": "Screenshot",
  "scan.done": "Added. You can close this tab.",
  "scan.locked": "The vault was locked; start the scan again.",
  "scan.finish": "Done",
};

export type ScanTranslate = (
  key: ScanKey | MessageKey,
  vars?: Record<string, string | number>,
) => string;

export function useScanT(): ScanTranslate {
  const locale = useLocale();
  const shared = useT();
  return useCallback<ScanTranslate>(
    (key, vars) => {
      const dictionary: Record<string, string> = locale === "tr" ? tr : en;
      const text = dictionary[key];
      if (text === undefined) return shared(key as MessageKey, vars);
      return text.replace(/\{(\w+)\}/g, (match, name: string) =>
        vars && name in vars ? String(vars[name]) : match,
      );
    },
    [locale, shared],
  );
}
