import { useState } from "react";

export type FontSize = "sm" | "md" | "lg" | "xl" | "xxl";
export type LineHeight = "compact" | "normal" | "relaxed";
export type FontFamily = "serif" | "sans";

/**
 * Hook for reader appearance settings (typography, zoom, UI popovers).
 * Zero coupling to other hooks — pure local UI state.
 */
export function useAppearance() {
  const [fontSize, setFontSize] = useState<FontSize>("md");
  const [lineHeight, setLineHeight] = useState<LineHeight>("normal");
  const [fontFamily, setFontFamily] = useState<FontFamily>("sans");
  const [readerZoom, setReaderZoom] = useState(100);
  const [showZoomPop, setShowZoomPop] = useState(false);
  const [pageMode, setPageMode] = useState(false);
  const [showTypoPop, setShowTypoPop] = useState(false);
  const [showThemePop, setShowThemePop] = useState(false);

  return {
    fontSize,
    setFontSize,
    lineHeight,
    setLineHeight,
    fontFamily,
    setFontFamily,
    readerZoom,
    setReaderZoom,
    showZoomPop,
    setShowZoomPop,
    pageMode,
    setPageMode,
    showTypoPop,
    setShowTypoPop,
    showThemePop,
    setShowThemePop,
  };
}
