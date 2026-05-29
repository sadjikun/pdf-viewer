from fiche import render_markdown, render_html

STORE = {
    "highlights": [
        {"key": "b::2", "color": "yellow", "text": "second point",
         "section": "rs_1", "sectionTitle": "1 Intro", "page": 8},
        {"key": "a::1", "color": "green", "text": "first point",
         "section": "rs_1", "sectionTitle": "1 Intro", "page": 5},
    ],
    "notes": {"a::1": "ma note"},
}


def test_markdown_contains_text_page_and_note():
    md = render_markdown("Mon Doc", STORE)
    assert "first point" in md
    assert "[p. 5]" in md
    assert "ma note" in md


def test_markdown_orders_highlights_by_page():
    md = render_markdown("Mon Doc", STORE)
    assert md.index("first point") < md.index("second point")


def test_html_has_blockquote_color_and_page():
    html = render_html("Mon Doc", STORE)
    assert "<blockquote" in html
    assert "yellow" in html or "green" in html
    assert "p. 5" in html


def test_fiche_md_endpoint_contains_highlight(client, doc_id):
    payload = {
        "highlights": [{"key": "rs_1::1", "color": "yellow",
                        "text": "phrase clef", "section": "rs_1",
                        "sectionTitle": "1 Intro", "page": 4}],
        "notes": {"rs_1::1": "important"},
    }
    client.put(f"/doc/{doc_id}/annotations", json=payload)
    res = client.get(f"/doc/{doc_id}/fiche?format=md")
    assert res.status_code == 200
    assert "phrase clef" in res.text
    assert "[p. 4]" in res.text
    assert "attachment" in res.headers.get("content-disposition", "")


def test_fiche_html_endpoint_ok(client, doc_id):
    client.put(f"/doc/{doc_id}/annotations", json={
        "highlights": [{"key": "k::1", "color": "green", "text": "abc",
                        "section": "rs_1", "sectionTitle": "1", "page": 2}],
        "notes": {},
    })
    res = client.get(f"/doc/{doc_id}/fiche?format=html")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "<blockquote" in res.text
