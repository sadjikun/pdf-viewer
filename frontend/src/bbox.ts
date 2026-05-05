import type { Bbox, PageInfo } from "./types";

/** Bbox en pourcentages relatifs à la page (origine haut-gauche, prêt pour CSS positionnement absolu). */
export interface PctRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Convertit une bbox Docling (BOTTOMLEFT, points PDF) en rectangle CSS en %.
 * Docling renvoie `[l, t, r, b]` avec t > b (origine bas, y croît vers le haut).
 * PDF.js / CSS attendent l'origine haut-gauche (y croît vers le bas).
 */
export function bboxToPct(bbox: Bbox, page: PageInfo): PctRect | null {
  if (page.width == null || page.height == null) return null;
  const [l, t, r, b] = bbox;
  const pw = page.width;
  const ph = page.height;
  return {
    left: (l / pw) * 100,
    top: ((ph - t) / ph) * 100,
    width: ((r - l) / pw) * 100,
    height: ((t - b) / ph) * 100,
  };
}
