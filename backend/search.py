import sqlite3
import threading
from pathlib import Path
import logging
import json
import re
import time

log = logging.getLogger(__name__)

ROOT = Path(__file__).parent
CACHE_DIR = ROOT / "cache"
DB_PATH = CACHE_DIR / "search_index.db"
db_lock = threading.Lock()

def _clean_title(title: str | None) -> str:
    if not title:
        return ""
    return re.sub(
        r"^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)", "", title, flags=re.IGNORECASE
    ).strip()

def get_db_connection() -> sqlite3.Connection:
    CACHE_DIR.mkdir(exist_ok=True, parents=True)
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    # Enable WAL mode for better concurrency and performance
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db() -> None:
    with db_lock:
        with get_db_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    doc_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    indexed_at REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS document_pages USING fts5(
                    doc_id,
                    page_number UNINDEXED,
                    text,
                    tokenize="unicode61"
                )
            """)
            conn.commit()

def index_document(doc_id: str) -> None:
    # Ensure BeautifulSoup is imported inside the function to avoid overhead or optional import issues
    from bs4 import BeautifulSoup

    doc_dir = CACHE_DIR / doc_id
    result_path = doc_dir / "result.json"
    if not result_path.exists():
        log.warning("Cannot index %s: result.json not found", doc_id)
        return

    try:
        with open(result_path, encoding="utf-8") as f:
            result = json.load(f)
    except Exception as e:
        log.error("Error reading result.json for %s: %s", doc_id, e)
        return

    source = doc_dir / "source.pdf"
    if not source.exists():
        source_files = sorted(doc_dir.glob("source.*"))
        source = source_files[0] if source_files else None

    filename = result.get("filename") or (source.name if source else doc_id)
    title = _clean_title(result.get("pdf_title")) or Path(filename).stem or doc_id

    pages_text: dict[int, str] = {}

    # 1. Try to index from HTML manifest/parts if it's a PDF/Docling extraction
    html_manifest_path = doc_dir / "html_manifest.json"
    if html_manifest_path.exists():
        try:
            with open(html_manifest_path, encoding="utf-8") as f:
                manifest = json.load(f)
            for part in manifest:
                part_file = part.get("file")
                start_page = part.get("start", 1)
                part_path = doc_dir / part_file
                if part_path.exists():
                    html_content = part_path.read_text(encoding="utf-8")
                    soup = BeautifulSoup(html_content, "html.parser")
                    docling_pages = soup.find_all("div", class_="docling-page")
                    if docling_pages:
                        for dp in docling_pages:
                            try:
                                pno = int(dp.get("data-page-no", start_page))
                            except (ValueError, TypeError):
                                pno = start_page
                            txt = dp.get_text(" ", strip=True)
                            if txt:
                                pages_text[pno] = pages_text.get(pno, "") + " " + txt
                    else:
                        txt = soup.get_text(" ", strip=True)
                        if txt:
                            pages_text[start_page] = pages_text.get(start_page, "") + " " + txt
        except Exception as e:
            log.error("Error parsing HTML parts for %s: %s", doc_id, e)

    # 2. Fallback to result.md (index under page 1) if no page texts were extracted
    if not pages_text:
        md_path = doc_dir / "result.md"
        if md_path.exists():
            try:
                md_text = md_path.read_text(encoding="utf-8")
                pages_text[1] = md_text
            except Exception as e:
                log.error("Error reading result.md fallback for %s: %s", doc_id, e)

    # 3. If still empty, check result.json (could contain a simple extraction or mock)
    if not pages_text and "text" in result:
        pages_text[1] = result["text"]

    # Save to SQLite FTS5
    with db_lock:
        with get_db_connection() as conn:
            # Delete any existing entries for this document
            conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
            conn.execute("DELETE FROM document_pages WHERE doc_id = ?", (doc_id,))

            # Insert metadata
            indexed_at = time.time()
            conn.execute(
                "INSERT INTO documents (doc_id, title, filename, indexed_at) VALUES (?, ?, ?, ?)",
                (doc_id, title, filename, indexed_at)
            )

            # Insert page texts
            for pno, txt in pages_text.items():
                cleaned_txt = " ".join(txt.split())
                if cleaned_txt:
                    conn.execute(
                        "INSERT INTO document_pages (doc_id, page_number, text) VALUES (?, ?, ?)",
                        (doc_id, pno, cleaned_txt)
                    )
            conn.commit()

    log.info("Successfully indexed document %s (%d pages)", doc_id, len(pages_text))

def remove_document(doc_id: str) -> None:
    with db_lock:
        with get_db_connection() as conn:
            conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
            conn.execute("DELETE FROM document_pages WHERE doc_id = ?", (doc_id,))
            conn.commit()
    log.info("Removed document %s from search index", doc_id)

def clean_fts_query(query: str) -> str:
    # Remove chars that are special in FTS5 except spaces and alphanumeric
    cleaned = re.sub(r'[^\w\s]', ' ', query)
    return " ".join(cleaned.split())

def search_index(query: str) -> list[dict]:
    if not query or not query.strip():
        return []

    sql = """
        SELECT 
            dp.doc_id, 
            dp.page_number, 
            snippet(document_pages, 2, '<b>', '</b>', '...', 64) as match_snippet,
            d.title,
            d.filename
        FROM document_pages dp
        JOIN documents d ON d.doc_id = dp.doc_id
        WHERE document_pages MATCH ?
        ORDER BY rank
        LIMIT 100
    """

    raw_query = query.strip()
    rows = []

    with db_lock:
        try:
            with get_db_connection() as conn:
                cur = conn.execute(sql, (raw_query,))
                rows = cur.fetchall()
        except sqlite3.OperationalError:
            cleaned = clean_fts_query(raw_query)
            if cleaned:
                try:
                    with get_db_connection() as conn:
                        cur = conn.execute(sql, (cleaned,))
                        rows = cur.fetchall()
                except Exception as e:
                    log.error("Search failed even with cleaned query: %s", e)
            else:
                return []

    results = []
    for r in rows:
        results.append({
            "doc_id": r[0],
            "page_number": int(r[1]),
            "snippet": r[2],
            "title": r[3],
            "filename": r[4]
        })
    return results

def sync_index() -> None:
    """Syncs the search index with the CACHE_DIR content on startup."""
    log.info("Starting search index sync...")
    init_db()

    # Get all documents in DB
    existing_docs = {}
    with db_lock:
        try:
            with get_db_connection() as conn:
                cur = conn.execute("SELECT doc_id, indexed_at FROM documents")
                for doc_id, idx_at in cur.fetchall():
                    existing_docs[doc_id] = idx_at
        except Exception as e:
            log.error("Failed to query indexed documents during sync: %s", e)
            return

    # Scan CACHE_DIR
    if not CACHE_DIR.exists():
        return

    doc_ids_on_disk = set()
    DOC_ID_RE = re.compile(r"^[a-f0-9]{16}$")

    for item in CACHE_DIR.iterdir():
        if not item.is_dir() or not DOC_ID_RE.fullmatch(item.name):
            continue
        doc_id = item.name
        doc_ids_on_disk.add(doc_id)

        result_json = item / "result.json"
        if not result_json.exists():
            continue

        try:
            mtime = result_json.stat().st_mtime
            # Reindex if missing, or if file on disk is newer than DB index timestamp
            if doc_id not in existing_docs or mtime > existing_docs[doc_id]:
                log.info("Sync: Indexing/updating document %s", doc_id)
                index_document(doc_id)
        except Exception as e:
            log.error("Failed to sync doc %s: %s", doc_id, e)

    # Clean up any documents in DB that no longer exist on disk
    for doc_id in existing_docs:
        if doc_id not in doc_ids_on_disk:
            log.info("Sync: Removing deleted document %s from index", doc_id)
            remove_document(doc_id)

    log.info("Search index sync completed.")
