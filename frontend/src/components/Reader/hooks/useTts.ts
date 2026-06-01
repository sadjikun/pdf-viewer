import { useState, useRef, useEffect, type RefObject } from "react";

/**
 * Hook for Text-to-Speech (TTS) functionality.
 * Manages speech synthesis state and controls.
 */
export function useTts(contentRef: RefObject<HTMLDivElement | null>) {
  const [ttsActive, setTtsActive] = useState(false);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsRate, setTtsRate] = useState(1.0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Get text for Speech Synthesis
  const getSpeakText = (): string => {
    if (!contentRef.current) return "";
    const docEl = contentRef.current.querySelector(".reader-doc");
    if (!docEl) return "";

    const temp = docEl.cloneNode(true) as HTMLElement;
    temp.querySelectorAll("script, style, .katex, annotation, math, svg").forEach(el => el.remove());
    return temp.textContent || "";
  };

  // TTS Controls
  const handlePlayTTS = () => {
    if (ttsPaused) {
      window.speechSynthesis.resume();
      setTtsPaused(false);
      return;
    }

    window.speechSynthesis.cancel();
    const text = getSpeakText();
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = ttsRate;

    utterance.onend = () => {
      setTtsActive(false);
      setTtsPaused(false);
    };

    utterance.onerror = () => {
      setTtsActive(false);
      setTtsPaused(false);
    };

    utteranceRef.current = utterance;
    setTtsActive(true);
    setTtsPaused(false);
    window.speechSynthesis.speak(utterance);
  };

  const handlePauseTTS = () => {
    if (ttsActive && !ttsPaused) {
      window.speechSynthesis.pause();
      setTtsPaused(true);
    }
  };

  const handleStopTTS = () => {
    window.speechSynthesis.cancel();
    setTtsActive(false);
    setTtsPaused(false);
  };

  // Clean up TTS on component unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  return {
    ttsActive,
    setTtsActive,
    ttsPaused,
    setTtsPaused,
    ttsRate,
    setTtsRate,
    handlePlayTTS,
    handlePauseTTS,
    handleStopTTS,
    getSpeakText,
  };
}
