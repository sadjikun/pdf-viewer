import { useState, useEffect } from "react";
import type { Section, PaperMeta } from "../readerHtml";
import type { OutlineNode, HtmlManifestEntry } from "../../../types";
import {
  parseMdSections,
  sectionizeHtml,
  extractPaperMeta,
  cleanPdfTitle,
} from "../readerHtml";
import {
  markdownUrl,
  htmlManifestUrl,
  htmlPartUrl,
  htmlUrl,
} from "../../../api";

interface UseContentLoadingParams {
  docId: string;
  filename?: string;
  pdfTitle?: string;
  outline?: OutlineNode[];
  setBreadcrumb: (b: string) => void;
  setPdfPageNos: (pages: number[]) => void;
}

export function useContentLoading(params: UseContentLoadingParams) {
  const { docId, filename, pdfTitle, outline, setBreadcrumb, setPdfPageNos } = params;

  const [md, setMd] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [rawHtmlForDownload, setRawHtmlForDownload] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [words, setWords] = useState(0);
  const [stats, setStats] = useState({ nFigures: 0, nTables: 0, nFormulas: 0 });
  const [htmlAvailable, setHtmlAvailable] = useState(false);
  const [htmlTooLarge, setHtmlTooLarge] = useState(false);
  const [renderMode, setRenderMode] = useState<"html" | "md">("md");
  const [error, setError] = useState<string | null>(null);
  const [paperMeta, setPaperMeta] = useState<PaperMeta | null>(null);

  useEffect(() => {
    const abortCtrl = new AbortController();

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMd(null);
    setHtmlContent(null);
    setRawHtmlForDownload(null);
    setSections([]);
    setWords(0);
    setStats({ nFigures: 0, nTables: 0, nFormulas: 0 });
    setHtmlAvailable(false);
    setHtmlTooLarge(false);
    setRenderMode("md");
    setError(null);
    setPaperMeta(null);
    setPdfPageNos([]);

    const initialBreadcrumb = cleanPdfTitle(pdfTitle) || (filename ? filename.replace(/\.[^.]+$/, "") : "Document");
    setBreadcrumb(initialBreadcrumb);

    fetch(markdownUrl(docId), { signal: abortCtrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((text) => {
        const cleanedText = text.replace(/\u200b/g, "");
        setMd(cleanedText);
        const secs = parseMdSections(cleanedText);
        const w = cleanedText.split(/\s+/).filter(Boolean).length;
        setSections((prev) => (prev.length ? prev : secs));
        setWords((prev) => prev || w);
      })
      .catch((e) => {
        if (e && e.name === "AbortError") return;
        setError(String(e));
      });

    function stripLargeBase64Images(raw: string): string {
      return raw.replace(
        /<img([^>]*?)src="data:image\/[^;]+;base64,[^"]{100000,}"([^>]*?)>/gi,
        "<img$1src=\"\"$2 data-stripped=\"1\">",
      );
    }

    function applyHtmlPart(
      raw: string,
      accHtml: string,
      accSections: Section[],
      accPdfPageNos: number[],
      accStats: { nFigures: number; nTables: number; nFormulas: number },
      idOffset: number,
    ) {
      const stripped = stripLargeBase64Images(raw);
      const { html, sections: secs, words: w, nFigures, nTables, nFormulas, pdfPageNos: partPageNos } =
        sectionizeHtml(stripped, outline ?? [], filename, idOffset, pdfTitle);
      const newHtml = accHtml + html;
      const newSections = [...accSections, ...secs];
      const newPdfPageNos = [...accPdfPageNos, ...partPageNos.filter(p => !accPdfPageNos.includes(p))];
      const newStats = {
        nFigures: accStats.nFigures + nFigures,
        nTables: accStats.nTables + nTables,
        nFormulas: accStats.nFormulas + nFormulas,
      };
      return { html: newHtml, sections: newSections, pdfPageNos: newPdfPageNos, stats: newStats, words: w };
    }

    fetch(htmlManifestUrl(docId), { signal: abortCtrl.signal })
      .then(r => r.ok ? (r.json() as Promise<HtmlManifestEntry[]>) : Promise.reject("no-manifest"))
      .then(async (manifest) => {
        if (!manifest.length) return Promise.reject("empty-manifest");

        let accHtml = "";
        let accSections: Section[] = [];
        let accPdfPageNos: number[] = [];
        let accStats = { nFigures: 0, nTables: 0, nFormulas: 0 };
        let totalWords = 0;
        let idOffset = 0;

        for (let i = 0; i < manifest.length; i++) {
          if (abortCtrl.signal.aborted) break;
          const entry = manifest[i];
          try {
            const partRes = await fetch(htmlPartUrl(docId, entry.start), { signal: abortCtrl.signal });
            if (!partRes.ok) continue;
            const raw = await partRes.text();
            const result = applyHtmlPart(raw, accHtml, accSections, accPdfPageNos, accStats, idOffset);
            accHtml = result.html;
            accSections = result.sections;
            accPdfPageNos = result.pdfPageNos;
            accStats = result.stats;
            if (i === 0) totalWords = result.words;
            idOffset += 500;

            if (i === 0) {
              if (!accHtml) { setHtmlTooLarge(true); break; }
              setHtmlContent(accHtml);
              setSections(accSections);
              setWords(totalWords);
              setStats(accStats);
              setPdfPageNos(accPdfPageNos);
              setHtmlAvailable(true);
              setRenderMode("html");
              setPaperMeta(extractPaperMeta(accHtml));
            } else {
              setHtmlContent(accHtml);
              setSections(accSections);
              setPdfPageNos(accPdfPageNos);
              setStats(accStats);
            }
          } catch (e: unknown) {
            if (e instanceof DOMException && e.name === "AbortError") break;
          }
        }
        setRawHtmlForDownload(accHtml);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const HTML_SIZE_LIMIT = 20 * 1024 * 1024;
        fetch(htmlUrl(docId), { signal: abortCtrl.signal })
          .then((r) => {
            if (!r.ok) throw new Error("no html");
            const cl = parseInt(r.headers.get("content-length") ?? "0", 10);
            if (cl > HTML_SIZE_LIMIT) { setHtmlTooLarge(true); throw new Error("too_large"); }
            return r.text();
          })
          .then((raw) => {
            if (raw.length > HTML_SIZE_LIMIT) { setHtmlTooLarge(true); return; }
            setRawHtmlForDownload(raw);
            const { html, sections: secs, words: w, nFigures, nTables, nFormulas, pdfPageNos: singlePageNos } =
              sectionizeHtml(raw, outline ?? [], filename, 0, pdfTitle);
            if (!html) { setHtmlTooLarge(true); return; }
            setHtmlContent(html);
            setSections(secs);
            setWords(w);
            setStats({ nFigures, nTables, nFormulas });
            setPdfPageNos(singlePageNos);
            setHtmlAvailable(true);
            setRenderMode("html");
            setPaperMeta(extractPaperMeta(html));
          })
          .catch(() => {});
      });

    return () => abortCtrl.abort();
  }, [docId, filename, outline, pdfTitle, setBreadcrumb, setPdfPageNos]);

  return {
    md,
    setMd,
    htmlContent,
    setHtmlContent,
    rawHtmlForDownload,
    setRawHtmlForDownload,
    sections,
    setSections,
    words,
    setWords,
    stats,
    setStats,
    htmlAvailable,
    setHtmlAvailable,
    htmlTooLarge,
    setHtmlTooLarge,
    renderMode,
    setRenderMode,
    error,
    setError,
    paperMeta,
    setPaperMeta,
  };
}
