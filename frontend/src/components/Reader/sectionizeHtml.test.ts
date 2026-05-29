import { describe, it, expect } from "vitest";
import { sectionizeHtml } from "./MarkdownReader";

// Regression tests for the FIX-035 de-embedding cluster (TD-014).
// FIX-035 turned base64 images into /html-image/ URLs, which silently disabled
// every Reader cleanup filter that keyed on `data:image/` / `data:`. These tests
// assert the filters work on de-embedded (URL) images, using the data-w/data-h
// pixel dimensions emitted by the backend de-embedder.

// Real cover structure from cache/7a009544df53f8b1 (native fast-path). The left
// column is the full-page PDF screenshot; the right column is the extracted
// docling-page content.
const COVER_HTML = `<table><tbody>
<tr>
<td><figure><img src="/doc/D/html-image/b0/000000.png"></figure></td>
<td><div class="pdf-page-sep" data-page="1" id="pdf-p-1"></div><div class="docling-page" data-page-no="1">
<h2>Guide for Design and Installation of Anchor Bolts Used in Transportation Structures</h2>
<h2>Parsons Brinckerhoff</h2>
<figure><img src="/doc/D/html-image/b0/000001.png"></figure>
<p>December 2008</p>
<p>Revision 0</p>
</div></td>
</tr>
</tbody></table>`;

describe("sectionizeHtml — cover (TD-014 / FIX-041)", () => {
  it("does not pull the full-page page-1 screenshot into the cover when the page has extracted text", () => {
    const { html } = sectionizeHtml(COVER_HTML, []);
    expect(html).not.toContain("000000.png"); // full-page screenshot excluded
    expect(html).toContain("Guide for Design and Installation of Anchor Bolts"); // extracted title kept
    expect(html).toContain("000001.png"); // legit inner cover figure kept
  });
});

describe("sectionizeHtml — de-embedded raster strip (#1, FIX-022)", () => {
  it("strips a leading captionless /html-image/ raster inside a docling-page", () => {
    const html = `<div class="docling-page" data-page-no="2">
<figure><img src="/doc/D/html-image/b1/RASTER.png"></figure>
<h3>Section Two</h3>
<p>Body text here.</p>
</div>`;
    const out = sectionizeHtml(html, []).html;
    expect(out).not.toContain("RASTER.png"); // leading full-page raster stripped
    expect(out).toContain("Section Two");
    expect(out).toContain("Body text here.");
  });
});

describe("sectionizeHtml — image-only table strip (#3, TD-011)", () => {
  it("removes a text-less table whose only content is a de-embedded image", () => {
    const html = `<div class="docling-page" data-page-no="5">
<h3>Gallery</h3>
<table><tbody><tr><td><figure><img src="/doc/D/html-image/b1/IMGTABLE.png"></figure></td></tr></tbody></table>
<p>Real content after.</p>
</div>`;
    const out = sectionizeHtml(html, []).html;
    expect(out).not.toContain("IMGTABLE.png");
    expect(out).toContain("Real content after.");
  });
});

describe("sectionizeHtml — logo filter via dimensions (#2, FIX-011)", () => {
  it("removes a tiny captionless de-embedded logo but keeps a large content figure", () => {
    const html = `<div class="docling-page" data-page-no="3">
<h3>Logo Test</h3>
<figure><img src="/doc/D/html-image/b1/LOGO.png" data-w="64" data-h="64"></figure>
<p>Body.</p>
<figure><img src="/doc/D/html-image/b1/BIGFIG.png" data-w="900" data-h="700"></figure>
</div>`;
    const out = sectionizeHtml(html, []).html;
    expect(out).not.toContain("LOGO.png"); // 64x64 → logo, removed
    expect(out).toContain("BIGFIG.png"); // 900x700 → content figure, kept
  });
});

describe("sectionizeHtml — proportional sizing via dimensions (#4, FIX-032)", () => {
  it("caps max-width of a small de-embedded image using data-w", () => {
    const html = `<div class="docling-page" data-page-no="4">
<figure><figcaption><div class="caption">A small diagram</div></figcaption><img src="/doc/D/html-image/b1/SMALL.png" data-w="300" data-h="200"></figure>
</div>`;
    const out = sectionizeHtml(html, []).html;
    expect(out).toContain("300px"); // max-width: min(300px, 100%)
  });
});

describe("sectionizeHtml — concatenated TOC split (TD-015 / FIX-025)", () => {
  it("splits a concatenated TOC blob with 3-level section numbers into separate entries", () => {
    // Docling can aggregate a whole TOC page into one <p> with no separators.
    // FIX-025's two-level regex (\d+\.\d+) missed three-level numbers like "6.1.1".
    const blob =
      "6.1.1Introduction to anchors6.1.2Snow load considerations" +
      "6.1.3Seismic design requirements6.1.4Wind load analysis and combinations";
    const { html } = sectionizeHtml(`<p>${blob}</p>`, []);
    expect(html).toContain("<p>6.1.2Snow load considerations</p>");
    expect(html).toContain("<p>6.1.3Seismic design requirements</p>");
  });
});
