/**
 * Stage-1 scanned-PDF pre-pass (CLIENT side, lazy-loaded).
 *
 * The browser renders a bounded set of low-text PDF pages to JPEG so scanned /
 * image-only PDFs can be understood by server-side vision — without any
 * server-side canvas dependency. Derivatives are uploaded to the owner's
 * storage prefix and registered as authenticated rows linked to the parent
 * PDF; the server re-verifies every derivative before vision (never trusts
 * arbitrary page-image ids).
 *
 * Text-based PDFs need no derivatives: the server reads the text layer.
 */

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return m;
    });
  }
  return pdfjsPromise;
}

export type PdfDerivative = {
  pageNumber: number;
  blob: Blob;
  name: string;
};

const MAX_SCAN_PAGES = 20;
const MAX_DERIVATIVES = 6;
/** Pages with fewer visible chars than this are treated as scanned images. */
const LOW_TEXT_CHARS = 40;

/** Render up to `maxPages` low-text pages of a PDF to JPEG blobs. */
export async function renderLowTextPages(file: File, baseName: string): Promise<PdfDerivative[]> {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const lowTextPages: number[] = [];
    const scan = Math.min(doc.numPages, MAX_SCAN_PAGES);
    for (let i = 1; i <= scan && lowTextPages.length < MAX_DERIVATIVES; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const chars = content.items.reduce((n, item) => n + ("str" in item ? item.str.length : 0), 0);
      if (chars < LOW_TEXT_CHARS) lowTextPages.push(i);
    }
    const out: PdfDerivative[] = [];
    for (const pageNumber of lowTextPages) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1600 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
      if (!blob) continue;
      out.push({ pageNumber, blob, name: `${baseName}-p${pageNumber}.jpg` });
    }
    return out;
  } finally {
    void doc.cleanup();
  }
}
