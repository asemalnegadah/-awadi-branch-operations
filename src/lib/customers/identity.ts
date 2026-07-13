const arabicDiacritics = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const punctuationOrSymbols = /[^\p{L}\p{N}\s]/gu;
const whitespace = /\s+/g;

const arabicDigitMap: Readonly<Record<string, string>> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

export function normalizeArabicName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(arabicDiacritics, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(punctuationOrSymbols, " ")
    .replace(whitespace, " ")
    .trim()
    .toLowerCase();
}

export function normalizePhone(value: string): string {
  const latinDigits = Array.from(value, (character) => arabicDigitMap[character] ?? character).join("");
  return latinDigits.replace(/\D/g, "");
}

export function normalizeExternalIdentifier(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

export function normalizeCustomerNumber(value: string): string {
  return normalizeExternalIdentifier(value).replace(/\s+/g, "");
}
