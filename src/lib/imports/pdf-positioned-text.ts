export interface PdfPositionedTextItem {
  readonly pageNumber: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPageGeometry {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPositionedDocument {
  readonly pages: readonly PdfPageGeometry[];
  readonly items: readonly PdfPositionedTextItem[];
}

export function assertValidPositionedTextItem(
  item: PdfPositionedTextItem,
): void {
  if (!Number.isInteger(item.pageNumber) || item.pageNumber <= 0) {
    throw new Error("رقم صفحة عنصر PDF غير صالح.");
  }

  if (!item.text.trim()) {
    throw new Error("عنصر PDF النصي فارغ.");
  }

  for (const [label, value] of Object.entries({
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  })) {
    if (!Number.isFinite(value)) {
      throw new Error(`إحداثي ${label} لعنصر PDF غير صالح.`);
    }
  }

  if (item.width < 0 || item.height < 0) {
    throw new Error("أبعاد عنصر PDF لا يمكن أن تكون سالبة.");
  }
}

export function textItemCenterX(item: PdfPositionedTextItem): number {
  return item.x + item.width / 2;
}
