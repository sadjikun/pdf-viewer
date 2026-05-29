declare module "katex/dist/contrib/auto-render.mjs" {
  function renderMathInElement(
    element: HTMLElement,
    options?: Record<string, unknown>,
  ): void;
  export default renderMathInElement;
}
