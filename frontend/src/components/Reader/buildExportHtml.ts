/**
 * Build and download a standalone HTML file with embedded highlights, notes, and interactive features.
 * This is a pure function with no React dependencies - can be tested independently.
 */

import { API_BASE } from '../../api';

interface Highlight {
  text: string;
  color: string;
  key: string;
  section?: string;
  sectionTitle?: string;
  page?: number;
  prefix?: string;
  suffix?: string;
}

interface PaperMeta {
  title: string | null;
  authors: string[];
  abstract: string | null;
  keywords: string[];
}

export interface ExportParams {
  htmlContent: string;
  highlights: Highlight[];
  notes: Record<string, string>;
  filename?: string;
  paperMeta?: PaperMeta | null;
}

function removeAllHighlights(container: HTMLElement): void {
  container.querySelectorAll('.reader-hl').forEach((span) => {
    const parent = span.parentNode;
    if (parent) {
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    }
  });
}

function restoreHighlight(
  container: HTMLElement,
  highlight: Highlight,
  hasNote: boolean,
): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  const nodes: Text[] = [];
  
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }
  
  const fullText = nodes.map((n) => n.textContent ?? '').join('');
  const startIndex = fullText.indexOf(highlight.text);
  
  if (startIndex === -1) return;
  
  const endIndex = startIndex + highlight.text.length;
  let charCount = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  
  for (const textNode of nodes) {
    const nodeLength = textNode.textContent?.length || 0;
    const nodeStart = charCount;
    const nodeEnd = charCount + nodeLength;
    
    if (!startNode && startIndex >= nodeStart && startIndex < nodeEnd) {
      startNode = textNode;
      startOffset = startIndex - nodeStart;
    }
    
    if (!endNode && endIndex > nodeStart && endIndex <= nodeEnd) {
      endNode = textNode;
      endOffset = endIndex - nodeStart;
      break;
    }
    
    charCount += nodeLength;
  }
  
  if (!startNode || !endNode) return;
  
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  
  const span = document.createElement('span');
  span.className = 'reader-hl';
  span.setAttribute('data-key', highlight.key);
  span.setAttribute('data-section', highlight.section ?? '');
  span.style.backgroundColor = highlight.color;
  
  if (hasNote) {
    span.classList.add('reader-hl--has-note');
  }
  
  range.surroundContents(span);
}

/**
 * Build a complete standalone HTML document with embedded CSS, JavaScript, highlights, and notes.
 * The exported HTML includes:
 * - All document content with highlights re-applied
 * - Embedded CSS for styling (light/dark themes, formulas, tables, notes panel)
 * - Embedded JavaScript for interactive features (note viewing, theme toggle, KaTeX rendering)
 * - Resolved absolute URLs for images
 */
export function buildExportHtml(params: ExportParams): string {
  const { htmlContent, highlights, notes, filename, paperMeta } = params;

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  removeAllHighlights(doc.body);
  highlights.forEach((hl) => {
    const hasNote = !!notes[hl.key];
    restoreHighlight(doc.body, hl, hasNote);
  });

  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (src.startsWith('/doc/')) {
      img.setAttribute('src', `${API_BASE}${src}`);
    }
  });

  const title = paperMeta?.title || filename || 'Document';

  const styles = `
    :root {
      --or: #ff8c00;
      --bg: #fafafa;
      --bg2: #ffffff;
      --bg3: #f3f4f6;
      --tx: #171717;
      --tx2: #404040;
      --tx3: #737373;
      --bd: #e5e7eb;
      --bd2: #d1d5db;
      --fu: 'Outfit', system-ui, sans-serif;
      --fb: 'Lora', 'Source Serif 4', Georgia, serif;
    }
    [data-theme="dark"] {
      --bg: #0a0b10;
      --bg2: #12131a;
      --bg3: #181a24;
      --tx: #f3f4f6;
      --tx2: #d1d5db;
      --tx3: #9ca3af;
      --bd: rgba(255, 255, 255, 0.08);
      --bd2: rgba(255, 255, 255, 0.16);
    }
    body {
      margin: 0;
      padding: 0;
      font-family: var(--fu);
      background: var(--bg);
      color: var(--tx);
      transition: background 0.3s, color 0.3s;
    }
    header {
      background: var(--bg2);
      border-bottom: 1px solid var(--bd);
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .logo {
      font-weight: 700;
      color: var(--or);
      font-size: 18px;
    }
    .tbtn {
      background: var(--bg3);
      border: 1px solid var(--bd);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--tx);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
    }
    .tbtn:hover {
      border-color: var(--or);
      color: var(--or);
    }
    .container {
      max-width: 800px;
      margin: 40px auto;
      padding: 0 24px;
    }
    .reader-hl {
      cursor: pointer;
      border-radius: 2px;
      padding: 1px 0;
      transition: background-color 0.2s;
    }
    .reader-hl--has-note {
      border-bottom: 2.5px dashed var(--or);
    }
    .reader-doc {
      line-height: 1.85;
      font-size: 16px;
      font-family: var(--fb);
    }
    .reader-doc h1 {
      font-family: var(--fu);
      border-bottom: 2px solid var(--or);
      padding-bottom: 8px;
      margin-top: 32px;
    }
    .reader-doc h2 {
      font-family: var(--fu);
      border-bottom: 1px solid var(--bd);
      padding-bottom: 6px;
      margin-top: 28px;
    }
    .reader-doc p {
      text-align: justify;
      margin-bottom: 16px;
    }
    annotation {
      display: none !important;
    }
    .formula, .equation {
      background: rgba(8, 145, 178, 0.05);
      border-left: 4px solid #0891b2;
      padding: 16px;
      margin: 20px 0;
      text-align: center;
      overflow-x: auto;
      border-radius: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 24px 0;
    }
    th {
      background: var(--or);
      color: white;
      padding: 10px;
      text-align: left;
    }
    td {
      border-bottom: 1px solid var(--bd);
      padding: 10px;
    }
    tr:nth-child(even) td {
      background: var(--bg3);
    }
    #note-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 320px;
      background: var(--bg2);
      border: 1px solid var(--bd2);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.15);
      display: none;
      z-index: 1000;
      box-sizing: border-box;
    }
    #note-panel h4 {
      margin: 0 0 8px 0;
      font-size: 13px;
      font-weight: 700;
      color: var(--or);
      text-transform: uppercase;
      letter-spacing: .05em;
    }
    #note-context {
      margin: 0 0 10px 0;
      font-size: 11px;
      color: var(--tx3);
      font-style: italic;
      background: var(--bg3);
      padding: 6px 10px;
      border-radius: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #note-text {
      width: 100%;
      height: 90px;
      background: var(--bg3);
      color: var(--tx);
      border: 1px solid var(--bd);
      border-radius: 8px;
      padding: 8px;
      font-family: inherit;
      font-size: 13px;
      box-sizing: border-box;
      margin-bottom: 12px;
      outline: none;
      resize: none;
    }
    .panel-buttons {
      display: flex;
      justify-content: flex-end;
    }
    .panel-btn {
      background: var(--or);
      color: white;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      cursor: pointer;
      font-weight: 600;
      font-family: inherit;
    }
    .pdf-page-marker {
      margin: 52px 0 0;
      user-select: none;
    }
    .pdf-page-footer-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 14px;
      background: var(--bg3);
      border: 1px solid var(--bd);
      border-bottom: none;
      font-family: var(--fu);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.04em;
      color: var(--tx3);
    }
    .pdf-page-header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 14px;
      background: var(--bg3);
      border: 1px solid var(--bd);
      border-top: none;
      font-family: var(--fu);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.04em;
      color: var(--tx3);
    }
    .pdf-pbb-pg--current {
      font-weight: 700;
      color: var(--or);
    }
    .pdf-page-divider-line {
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--bd2) 20%, var(--bd2) 80%, transparent);
    }
    @media print {
      @page {
        size: A4 portrait;
        margin: 20mm;
      }
      body, .container, .reader-doc {
        background: #ffffff !important;
        background-color: #ffffff !important;
        color: #000000 !important;
      }
      header {
        display: none !important;
      }
      .container {
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .reader-doc p, .reader-doc li, .reader-doc h1, .reader-doc h2, .reader-doc h3, .reader-doc h4 {
        color: #000000 !important;
      }
      .pdf-page-marker {
        display: block !important;
        margin: 0 !important;
        padding: 0 !important;
        background: transparent !important;
        border: none !important;
      }
      .pdf-page-footer-bar {
        display: flex !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
        margin-top: 10mm !important;
        border: none !important;
        background: transparent !important;
      }
      .pdf-page-header-bar {
        display: flex !important;
        page-break-before: always !important;
        break-before: page !important;
        margin-top: 10mm !important;
        border: none !important;
        background: transparent !important;
      }
      .pdf-page-divider-line {
        display: none !important;
      }
      table, tr, td, th {
        background: transparent !important;
        background-color: transparent !important;
        color: #000000 !important;
        border-color: #dddddd !important;
      }
      th {
        border-bottom: 2px solid #000000 !important;
      }
    }
  `;

  const notesJson = JSON.stringify(notes);
  const script = `
    const notes = ${notesJson};
    document.addEventListener('DOMContentLoaded', () => {
      const panel = document.getElementById('note-panel');
      const context = document.getElementById('note-context');
      const text = document.getElementById('note-text');
      
      document.querySelectorAll('.reader-hl').forEach(span => {
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = span.getAttribute('data-key');
          context.textContent = span.textContent.slice(0, 60) + '...';
          text.value = notes[key] || "Pas de note pour ce surlignage.";
          panel.style.display = 'block';
        });
      });
      
      document.getElementById('close-panel').addEventListener('click', () => {
        panel.style.display = 'none';
      });

      const themeBtn = document.getElementById('theme-btn');
      let currentTheme = localStorage.getItem('theme') || 'light';
      document.documentElement.setAttribute('data-theme', currentTheme);
      themeBtn.textContent = currentTheme === 'dark' ? '☀️ Mode Clair' : '🌙 Mode Sombre';

      themeBtn.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', currentTheme);
        localStorage.setItem('theme', currentTheme);
        themeBtn.textContent = currentTheme === 'dark' ? '☀️ Mode Clair' : '🌙 Mode Sombre';
      });
    });
  `;

  return `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
  <style>${styles}</style>
</head>
<body>
  <header>
    <div class="logo">📚 ${title}</div>
    <div style="display:flex; gap:10px;">
      <button id="theme-btn" class="tbtn">🌙 Mode Sombre</button>
      <button class="tbtn" onclick="window.print()">🖨 Imprimer</button>
    </div>
  </header>

  <div class="container">
    <div class="reader-doc">
      ${doc.body.innerHTML}
    </div>
  </div>
  
  <div id="note-panel">
    <h4>Annotation</h4>
    <div id="note-context"></div>
    <textarea id="note-text" readonly></textarea>
    <div class="panel-buttons">
      <button id="close-panel" class="panel-btn">Fermer</button>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js"></script>
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      renderMathInElement(document.body, {
        delimiters: [
          {left: "$$", right: "$$", display: true},
          {left: "$", right: "$", display: false},
          {left: "\\\\(", right: "\\\\)", display: false},
          {left: "\\\\[", right: "\\\\]", display: true}
        ],
        throwOnError: false
      });
    });
  </script>
  <script>${script}</script>
</body>
</html>`;
}

/**
 * Trigger a browser download of the provided HTML string.
 */
export function downloadHtmlFile(html: string, downloadName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = downloadName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
