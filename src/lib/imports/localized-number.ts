const digitMap: Readonly<Record<string, string>> = {
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

export function parseLocalizedMoneyToMinor(
  rawValue: string,
  decimalPlaces = 2,
): number {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) {
    throw new Error("عدد المنازل العشرية غير صالح.");
  }

  const normalizedDigits = Array.from(rawValue, (character) =>
    digitMap[character] ?? character,
  ).join("");

  const trimmed = normalizedDigits.trim();
  if (!trimmed) {
    throw new Error("قيمة المبلغ فارغة.");
  }

  const negativeByParentheses = /^\(.*\)$/.test(trimmed);
  const stripped = trimmed
    .replace(/^\(|\)$/g, "")
    .replace(/[\s٬،']/g, "")
    .replace(/ر\.?(س|ي)|ريال|sr|rg/gi, "");

  const negativeBySign = stripped.startsWith("-");
  const positiveBySign = stripped.startsWith("+");
  const unsigned = negativeBySign || positiveBySign ? stripped.slice(1) : stripped;

  const canonical = normalizeSeparators(unsigned, decimalPlaces);
  if (!/^\d+(\.\d+)?$/.test(canonical)) {
    throw new Error(`صيغة مبلغ غير صالحة: ${rawValue}`);
  }

  const [integerPart = "0", fractionalPart = ""] = canonical.split(".");
  if (fractionalPart.length > decimalPlaces) {
    throw new Error("عدد الكسور في المبلغ أكبر من المسموح.");
  }

  const minorText = `${integerPart}${fractionalPart.padEnd(decimalPlaces, "0")}`
    .replace(/^0+(?=\d)/, "");
  const absoluteMinor = Number(minorText || "0");

  if (!Number.isSafeInteger(absoluteMinor)) {
    throw new Error("المبلغ يتجاوز النطاق الرقمي الآمن.");
  }

  const isNegative = negativeByParentheses || negativeBySign;
  return isNegative ? -absoluteMinor : absoluteMinor;
}

function normalizeSeparators(value: string, decimalPlaces: number): string {
  const arabicDecimalNormalized = value.replace(/٫/g, ".");
  const dotCount = (arabicDecimalNormalized.match(/\./g) ?? []).length;
  const commaCount = (arabicDecimalNormalized.match(/,/g) ?? []).length;

  if (dotCount > 0 && commaCount > 0) {
    const lastDot = arabicDecimalNormalized.lastIndexOf(".");
    const lastComma = arabicDecimalNormalized.lastIndexOf(",");
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const thousandsSeparator = decimalSeparator === "." ? "," : ".";

    return arabicDecimalNormalized
      .split(thousandsSeparator)
      .join("")
      .replace(decimalSeparator, ".");
  }

  if (commaCount > 0) {
    return normalizeSingleSeparator(arabicDecimalNormalized, ",", decimalPlaces);
  }

  if (dotCount > 0) {
    return normalizeSingleSeparator(arabicDecimalNormalized, ".", decimalPlaces);
  }

  return arabicDecimalNormalized;
}

function normalizeSingleSeparator(
  value: string,
  separator: "." | ",",
  decimalPlaces: number,
): string {
  const parts = value.split(separator);

  if (parts.length === 2 && parts[1] && parts[1].length <= decimalPlaces) {
    return `${parts[0]}.${parts[1]}`;
  }

  return parts.join("");
}
