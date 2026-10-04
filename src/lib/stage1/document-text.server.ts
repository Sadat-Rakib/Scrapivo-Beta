import { extractText, getDocumentProxy } from "unpdf";

/**
 * Stage-1 PDF text extraction (server, pure-JS via unpdf).
 * A PDF whose pages yield almost no text is a scanned/image-only document —
 * the resolver then falls back to vision over CLIENT-rendered page
 * derivatives (authenticated registry rows linked to the parent PDF).
 */

export type PdfExtraction = {
  pages: string[];
  totalChars: number;
};

/** Extract per-page text. Returns null when the bytes are not a readable PDF. */
export async function extractPdfPages(bytes: Uint8Array): Promise<PdfExtraction | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [String(text)]).map((t) => (t ?? "").replace(/\s+/g, " ").trim());
    return { pages, totalChars: pages.join("").length };
  } catch {
    return null;
  }
}

/** Below ~400 chars total the PDF has no usable text layer (scanned). */
export function pdfTextIsSufficient(pdf: PdfExtraction): boolean {
  return pdf.totalChars >= 120;
}
