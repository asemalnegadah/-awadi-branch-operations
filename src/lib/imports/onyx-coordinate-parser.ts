import {
  assertValidPositionedTextItem,
  textItemCenterX,
  type PdfPositionedTextItem,
} from "./pdf-positioned-text";

export const onyxDebtColumnKeys = [
  "customerNumber",
  "customerName",
  "representativeCode",
  "currency",
  "amount",
  "localAmount",
  "days0To30",
  "days31To60",
  "days61To90",
  "days91To120",
  "over120",
  "totalDue",
] as const;

export type OnyxDebtColumnKey = (typeof onyxDebtColumnKeys)[number];

export interface OnyxDebtAgingCoordinateRow {
  readonly customerNumber: string;
  readonly customerName: string;
  readonly representativeCode?: string | undefined;
  readonly currency: "SR" | "RG";
  readonly amount?: string | undefined;
  readonly localAmount?: string | undefined;
  readonly days0To30?: string | undefined;
  readonly days31To60?: string | undefined;
  readonly days61To90?: string | undefined;
  readonly days91To120?: string | undefined;
  readonly over120?: string | undefined;
  readonly totalDue?: string | undefined;
  readonly sourcePage: number;
  readonly sourceY: number;
  readonly warnings: readonly string[];
}

export interface OnyxCoordinateParserOptions {
  readonly lineTolerance?: number | undefined;
  readonly minimumHeaderColumns?: number | undefined;
  readonly continuationDistance?: number | undefined;
}

interface PositionedLine {
  readonly pageNumber: number;
  readonly y: number;
  readonly items: readonly PdfPositionedTextItem[];
}

interface HeaderColumn {
  readonly key: OnyxDebtColumnKey;
  readonly centerX: number;
}

interface PageHeaderLayout {
  readonly pageNumber: number;
  readonly headerYs: readonly number[];
  readonly columns: readonly HeaderColumn[];
}

interface AssignedLine {
  readonly line: PositionedLine;
  readonly cells: ReadonlyMap<OnyxDebtColumnKey, readonly PdfPositionedTextItem[]>;
}

const headerAliases: Readonly<
  Record<OnyxDebtColumnKey, readonly string[]>
> = Object.freeze({
  customerNumber: Object.freeze(["رقم العميل", "كود العميل"]),
  customerName: Object.freeze(["اسم العميل", "العميل"]),
  representativeCode: Object.freeze(["المندوب", "رقم المندوب"]),
  currency: Object.freeze(["العمله", "العملة"]),
  amount: Object.freeze(["المبلغ"]),
  localAmount: Object.freeze([
    "المبلغ بالعمله المحليه",
    "المبلغ بالعملة المحلية",
    "المحلي",
  ]),
  days0To30: Object.freeze(["0 30", "30 0"]),
  days31To60: Object.freeze(["31 60", "60 31"]),
  days61To90: Object.freeze(["61 90", "90 61"]),
  days91To120: Object.freeze(["91 120", "120 91"]),
  over120: Object.freeze(["اكثر من 120", "120", "120 <", "> 120"]),
  totalDue: Object.freeze([
    "اجمالي المستحق",
    "إجمالي المستحق",
    "الاجمالي",
    "الإجمالي",
  ]),
});

export function extractOnyxDebtRowsFromCoordinates(
  rawItems: readonly PdfPositionedTextItem[],
  options: OnyxCoordinateParserOptions = {},
): readonly OnyxDebtAgingCoordinateRow[] {
  const lineTolerance = options.lineTolerance ?? 3;
  const minimumHeaderColumns = options.minimumHeaderColumns ?? 8;
  const continuationDistance = options.continuationDistance ?? 18;

  if (lineTolerance <= 0 || continuationDistance <= 0) {
    throw new Error("حدود تجميع إحداثيات PDF يجب أن تكون موجبة.");
  }

  const items = rawItems
    .map((item) => {
      assertValidPositionedTextItem(item);
      return Object.freeze({ ...item, text: item.text.trim() });
    })
    .filter((item) => item.text.length > 0);

  const lines = clusterItemsIntoLines(items, lineTolerance);
  const pages = new Map<number, PositionedLine[]>();

  for (const line of lines) {
    const pageLines = pages.get(line.pageNumber) ?? [];
    pageLines.push(line);
    pages.set(line.pageNumber, pageLines);
  }

  const rows: OnyxDebtAgingCoordinateRow[] = [];

  for (const [pageNumber, pageLines] of pages.entries()) {
    const layout = detectPageHeaderLayout(
      pageNumber,
      pageLines,
      minimumHeaderColumns,
      lineTolerance,
    );

    if (!layout) {
      continue;
    }

    const assignedLines = pageLines
      .filter(
        (line) =>
          !layout.headerYs.some(
            (headerY) => Math.abs(headerY - line.y) <= lineTolerance,
          ),
      )
      .map((line) => assignLineToColumns(line, layout.columns));

    const primaryRows = assignedLines
      .map((assigned) => buildPrimaryRow(assigned))
      .filter((row): row is OnyxDebtAgingCoordinateRow => row !== null);

    const continuations = assignedLines.filter(isNameOnlyContinuation);
    const enrichedRows = attachNameContinuations(
      primaryRows,
      continuations,
      continuationDistance,
    );

    rows.push(...enrichedRows);
  }

  return Object.freeze(
    rows.sort(
      (left, right) =>
        left.sourcePage - right.sourcePage || right.sourceY - left.sourceY,
    ),
  );
}

function clusterItemsIntoLines(
  items: readonly PdfPositionedTextItem[],
  tolerance: number,
): readonly PositionedLine[] {
  const sorted = [...items].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      right.y - left.y ||
      left.x - right.x,
  );
  const lines: Array<{
    pageNumber: number;
    yTotal: number;
    count: number;
    items: PdfPositionedTextItem[];
  }> = [];

  for (const item of sorted) {
    const current = lines.at(-1);
    const currentY = current ? current.yTotal / current.count : undefined;

    if (
      current &&
      current.pageNumber === item.pageNumber &&
      currentY !== undefined &&
      Math.abs(currentY - item.y) <= tolerance
    ) {
      current.items.push(item);
      current.yTotal += item.y;
      current.count += 1;
      continue;
    }

    lines.push({
      pageNumber: item.pageNumber,
      yTotal: item.y,
      count: 1,
      items: [item],
    });
  }

  return Object.freeze(
    lines.map((line) =>
      Object.freeze({
        pageNumber: line.pageNumber,
        y: line.yTotal / line.count,
        items: Object.freeze([...line.items]),
      }),
    ),
  );
}

function detectPageHeaderLayout(
  pageNumber: number,
  lines: readonly PositionedLine[],
  minimumHeaderColumns: number,
  lineTolerance: number,
): PageHeaderLayout | null {
  let best:
    | {
        score: number;
        headerYs: number[];
        columns: HeaderColumn[];
      }
    | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    if (!current) continue;

    const bands: PositionedLine[][] = [[current]];
    const next = lines[index + 1];

    if (
      next &&
      next.pageNumber === current.pageNumber &&
      Math.abs(current.y - next.y) <= lineTolerance * 6
    ) {
      bands.push([current, next]);
    }

    for (const band of bands) {
      const columns = detectHeaderColumns(band.flatMap((line) => line.items));
      const distinctKeys = new Set(columns.map((column) => column.key));
      const requiredPresent =
        distinctKeys.has("customerNumber") &&
        distinctKeys.has("customerName") &&
        distinctKeys.has("currency") &&
        distinctKeys.has("amount");

      if (!requiredPresent || distinctKeys.size < minimumHeaderColumns) {
        continue;
      }

      const score = distinctKeys.size;
      if (!best || score > best.score) {
        best = {
          score,
          headerYs: band.map((line) => line.y),
          columns: deduplicateHeaderColumns(columns),
        };
      }
    }
  }

  if (!best) {
    return null;
  }

  return Object.freeze({
    pageNumber,
    headerYs: Object.freeze(best.headerYs),
    columns: Object.freeze(best.columns),
  });
}

function detectHeaderColumns(
  items: readonly PdfPositionedTextItem[],
): HeaderColumn[] {
  const sorted = [...items].sort((left, right) => left.x - right.x);
  const matches: HeaderColumn[] = [];

  for (let start = 0; start < sorted.length; start += 1) {
    for (let length = 1; length <= 3; length += 1) {
      const span = sorted.slice(start, start + length);
      if (span.length !== length) continue;

      const forward = normalizeHeaderText(span.map((item) => item.text).join(" "));
      const reverse = normalizeHeaderText(
        [...span]
          .reverse()
          .map((item) => item.text)
          .join(" "),
      );

      for (const key of onyxDebtColumnKeys) {
        if (
          headerAliases[key].some((alias) => {
            const normalizedAlias = normalizeHeaderText(alias);
            return forward === normalizedAlias || reverse === normalizedAlias;
          })
        ) {
          const minimumX = Math.min(...span.map((item) => item.x));
          const maximumX = Math.max(
            ...span.map((item) => item.x + item.width),
          );
          matches.push({ key, centerX: (minimumX + maximumX) / 2 });
        }
      }
    }
  }

  return matches;
}

function deduplicateHeaderColumns(
  columns: readonly HeaderColumn[],
): HeaderColumn[] {
  const byKey = new Map<OnyxDebtColumnKey, HeaderColumn>();

  for (const column of columns) {
    const existing = byKey.get(column.key);
    if (!existing) {
      byKey.set(column.key, column);
      continue;
    }

    if (column.key === "over120") {
      const aliasCenterLikelyMoreSpecific = column.centerX < existing.centerX;
      if (aliasCenterLikelyMoreSpecific) byKey.set(column.key, column);
    }
  }

  return [...byKey.values()].sort(
    (left, right) => left.centerX - right.centerX,
  );
}

function assignLineToColumns(
  line: PositionedLine,
  columns: readonly HeaderColumn[],
): AssignedLine {
  const cells = new Map<OnyxDebtColumnKey, PdfPositionedTextItem[]>();
  const sortedColumns = [...columns].sort(
    (left, right) => left.centerX - right.centerX,
  );
  const boundaries = sortedColumns.slice(0, -1).map(
    (column, index) =>
      (column.centerX + (sortedColumns[index + 1]?.centerX ?? column.centerX)) /
      2,
  );

  for (const item of line.items) {
    const center = textItemCenterX(item);
    let columnIndex = boundaries.findIndex((boundary) => center < boundary);
    if (columnIndex === -1) columnIndex = sortedColumns.length - 1;

    const column = sortedColumns[columnIndex];
    if (!column) continue;

    const existing = cells.get(column.key) ?? [];
    existing.push(item);
    cells.set(column.key, existing);
  }

  return Object.freeze({
    line,
    cells: new Map(
      [...cells.entries()].map(([key, value]) => [
        key,
        Object.freeze([...value]),
      ]),
    ),
  });
}

function buildPrimaryRow(
  assigned: AssignedLine,
): OnyxDebtAgingCoordinateRow | null {
  const customerNumber = normalizeCustomerNumber(
    readCell(assigned.cells, "customerNumber"),
  );
  const customerName = readCell(assigned.cells, "customerName");
  const currencyText = readCell(assigned.cells, "currency").toUpperCase();

  if (
    !/^\d{3,12}$/.test(customerNumber) ||
    !customerName ||
    (currencyText !== "SR" && currencyText !== "RG")
  ) {
    return null;
  }

  const warnings: string[] = [];
  const representativeCode = normalizeCustomerNumber(
    readCell(assigned.cells, "representativeCode"),
  );

  if (!representativeCode) {
    warnings.push("كود المندوب غير موجود في الصف المستخرج.");
  }

  if (!hasAnyDebtValue(assigned.cells)) {
    warnings.push("لا توجد قيمة مديونية واضحة في الصف المستخرج.");
  }

  return Object.freeze({
    customerNumber,
    customerName,
    representativeCode: representativeCode || undefined,
    currency: currencyText,
    amount: optionalCell(assigned.cells, "amount"),
    localAmount: optionalCell(assigned.cells, "localAmount"),
    days0To30: optionalCell(assigned.cells, "days0To30"),
    days31To60: optionalCell(assigned.cells, "days31To60"),
    days61To90: optionalCell(assigned.cells, "days61To90"),
    days91To120: optionalCell(assigned.cells, "days91To120"),
    over120: optionalCell(assigned.cells, "over120"),
    totalDue: optionalCell(assigned.cells, "totalDue"),
    sourcePage: assigned.line.pageNumber,
    sourceY: assigned.line.y,
    warnings: Object.freeze(warnings),
  });
}

function isNameOnlyContinuation(assigned: AssignedLine): boolean {
  if (!readCell(assigned.cells, "customerName")) return false;

  for (const key of onyxDebtColumnKeys) {
    if (key === "customerName") continue;
    if (readCell(assigned.cells, key)) return false;
  }

  return true;
}

function attachNameContinuations(
  rows: readonly OnyxDebtAgingCoordinateRow[],
  continuations: readonly AssignedLine[],
  maximumDistance: number,
): OnyxDebtAgingCoordinateRow[] {
  const mutable = rows.map((row) => ({ ...row, warnings: [...row.warnings] }));

  for (const continuation of continuations) {
    const namePart = readCell(continuation.cells, "customerName");
    if (!namePart) continue;

    const candidates = mutable
      .filter((row) => row.sourcePage === continuation.line.pageNumber)
      .map((row) => ({ row, distance: Math.abs(row.sourceY - continuation.line.y) }))
      .filter((candidate) => candidate.distance <= maximumDistance)
      .sort((left, right) => left.distance - right.distance);

    const winner = candidates[0]?.row;
    if (!winner) continue;

    winner.customerName = `${winner.customerName} ${namePart}`.replace(/\s+/g, " ").trim();
    if (!winner.warnings.includes("اسم العميل ممتد إلى سطر ثانٍ في PDF.")) {
      winner.warnings.push("اسم العميل ممتد إلى سطر ثانٍ في PDF.");
    }
  }

  return mutable.map((row) =>
    Object.freeze({
      ...row,
      warnings: Object.freeze([...row.warnings]),
    }),
  );
}

function readCell(
  cells: ReadonlyMap<OnyxDebtColumnKey, readonly PdfPositionedTextItem[]>,
  key: OnyxDebtColumnKey,
): string {
  const items = cells.get(key) ?? [];
  const ordered = [...items].sort((left, right) => right.x - left.x);
  return ordered
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function optionalCell(
  cells: ReadonlyMap<OnyxDebtColumnKey, readonly PdfPositionedTextItem[]>,
  key: OnyxDebtColumnKey,
): string | undefined {
  const value = readCell(cells, key);
  return value || undefined;
}

function hasAnyDebtValue(
  cells: ReadonlyMap<OnyxDebtColumnKey, readonly PdfPositionedTextItem[]>,
): boolean {
  return [
    "amount",
    "localAmount",
    "days0To30",
    "days31To60",
    "days61To90",
    "days91To120",
    "over120",
    "totalDue",
  ].some((key) => readCell(cells, key as OnyxDebtColumnKey).length > 0);
}

function normalizeCustomerNumber(value: string): string {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";

  return value
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/\s+/g, "")
    .trim();
}

function normalizeHeaderText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[^\p{L}\p{N}<>]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
