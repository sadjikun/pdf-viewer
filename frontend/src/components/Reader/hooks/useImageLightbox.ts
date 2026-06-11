import { useState, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';
import type { Figure } from '../../../types';

export function useImageLightbox(contentRef: RefObject<HTMLDivElement | null>) {
  const [readerImageIdx, setReaderImageIdx] = useState<number | null>(null);
  const [readerImages, setReaderImages] = useState<Figure[]>([]);

  // Collect all images in the current reader view
  const getReaderImages = useCallback((): Figure[] => {
    const el = contentRef.current;
    if (!el) return [];
    const imgs = el.querySelectorAll("img");
    const list: Figure[] = [];
    imgs.forEach((img) => {
      const src = img.src || img.getAttribute("src") || "";
      if (!src) return;
      if (list.some((item) => item.id === src)) return;
      const pageNoAttr = img.closest(".docling-page")?.getAttribute("data-page-no");
      const page = pageNoAttr ? parseInt(pageNoAttr, 10) : null;
      const captionText = img.closest("figure")?.querySelector("figcaption")?.textContent || "";
      list.push({
        id: src,
        page,
        bbox: null,
        caption: captionText,
      });
    });
    return list;
  }, [contentRef]);

  // Image lightbox (click to zoom)
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const img = (e.target as Element).closest("img") as HTMLImageElement | null;
      if (!img) return;
      const src = img.src || img.getAttribute("src");
      if (src) {
        const imgs = getReaderImages();
        setReaderImages(imgs);
        const idx = imgs.findIndex((item) => item.id === src);
        if (idx !== -1) {
          setReaderImageIdx(idx);
        } else {
          setReaderImages([{ id: src, page: null, bbox: null, caption: img.alt || "" }]);
          setReaderImageIdx(0);
        }
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [contentRef, getReaderImages]);

  // Escape key to close lightbox
  useEffect(() => {
    if (readerImageIdx === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReaderImageIdx(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readerImageIdx]);

  return {
    readerImageIdx,
    setReaderImageIdx,
    readerImages,
  };
}
