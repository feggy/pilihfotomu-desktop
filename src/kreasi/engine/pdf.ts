/**
 * A minimal PDF writer: one JPEG per page, each page the size given in points
 * (1/72 inch). JPEG goes in as it is (DCTDecode), so nothing is re-encoded —
 * a few dozen lines instead of a PDF library.
 */
export async function makePdf(
  pages: { jpeg: Blob; width: number; height: number }[],
  pageWidthPt: number,
  pageHeightPt: number,
): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (part: Uint8Array<ArrayBuffer> | string) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    parts.push(bytes);
    size += bytes.length;
  };
  /** Starts object `n`, noting where it begins for the cross-reference table. */
  const obj = (n: number, body: string) => {
    offsets[n] = size;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%âãÏÓ\n');
  // 1: catalog, 2: page tree; then per page: page, content, image.
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  const w = pageWidthPt.toFixed(2);
  const h = pageHeightPt.toFixed(2);
  for (const [i, page] of pages.entries()) {
    const [pageId, contentId, imageId] = [pageIds[i]!, pageIds[i]! + 1, pageIds[i]! + 2];
    obj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    // The image stretched over the whole page.
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const jpeg = new Uint8Array(await page.jpeg.arrayBuffer());
    offsets[imageId] = size;
    push(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    push(jpeg);
    push('\nendstream\nendobj\n');
  }

  const count = 3 + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
