import sqlite3
import logging
import requests
import re
from pathlib import Path
from search import get_db_connection, db_lock, clean_fts_query

log = logging.getLogger(__name__)

OLLAMA_BASE_URL = "http://127.0.0.1:11434"

def check_ollama_status() -> dict:
    """Verifies connection to local Ollama and lists available models."""
    try:
        res = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3.0)
        if res.status_code == 200:
            data = res.json()
            models = []
            for m in data.get("models", []):
                models.append({
                    "name": m.get("name"),
                    "size": m.get("size", 0)
                })
            return {"available": True, "models": models}
    except Exception as e:
        log.warning("Ollama connection failed: %s", e)
    
    return {"available": False, "models": []}

def to_fts_and_query(query: str) -> str:
    """Converts a natural language query into a Boolean AND FTS5 query."""
    words = re.findall(r'\w+', query)
    if not words:
        return ""
    # Common French/English stop words to filter out to prevent matching noise
    stop_words = {
        "est", "une", "les", "des", "que", "qui", "dans", "pour", "par", "sur", "aux", 
        "the", "and", "for", "are", "with", "what", "how", "why", "quel", "quels", 
        "quelle", "quelles", "avec", "dans", "sous", "mais", "sur", "cette"
    }
    filtered = [w for w in words if len(w) > 2 and w.lower() not in stop_words]
    if not filtered:
        filtered = [w for w in words if len(w) > 1]
    if not filtered:
        filtered = words
    return " AND ".join(filtered)

def query_rag(query: str, doc_id: str | None = None, model: str = "qwen3.5:9b") -> dict:
    """Retrieves context from FTS5 index and queries local Ollama LLM."""
    if not query or not query.strip():
        return {"answer": "La question est vide.", "sources": []}

    # 1. Retrieve relevant pages using FTS5
    # Generate FTS match query
    raw_query = query.strip()
    fts_query = to_fts_and_query(raw_query)
    
    # We retrieve up to 4 relevant pages
    limit = 4
    
    if doc_id:
        sql = """
            SELECT 
                dp.doc_id, 
                dp.page_number, 
                dp.text, 
                d.title, 
                d.filename,
                snippet(document_pages, 2, '<b>', '</b>', '...', 64) as match_snippet
            FROM document_pages dp
            JOIN documents d ON d.doc_id = dp.doc_id
            WHERE dp.doc_id = ? AND document_pages MATCH ?
            ORDER BY rank
            LIMIT ?
        """
        params = (doc_id, fts_query, limit)
    else:
        sql = """
            SELECT 
                dp.doc_id, 
                dp.page_number, 
                dp.text, 
                d.title, 
                d.filename,
                snippet(document_pages, 2, '<b>', '</b>', '...', 64) as match_snippet
            FROM document_pages dp
            JOIN documents d ON d.doc_id = dp.doc_id
            WHERE document_pages MATCH ?
            ORDER BY rank
            LIMIT ?
        """
        params = (fts_query, limit)

    rows = []
    with db_lock:
        try:
            with get_db_connection() as conn:
                if fts_query:
                    cur = conn.execute(sql, params)
                    rows = cur.fetchall()
        except sqlite3.OperationalError:
            # Fallback to cleaned query if syntax fails
            cleaned = clean_fts_query(raw_query)
            if cleaned:
                try:
                    with get_db_connection() as conn:
                        if doc_id:
                            cur = conn.execute(sql, (doc_id, cleaned, limit))
                        else:
                            cur = conn.execute(sql, (cleaned, limit))
                        rows = cur.fetchall()
                except Exception as e:
                    log.error("FTS retrieval failed even with cleaned query: %s", e)
            else:
                log.info("Query became empty after sanitization")

    sources = []
    context_blocks = []
    
    for r in rows:
        r_doc_id, r_page, r_text, r_title, r_filename, r_snippet = r
        sources.append({
            "doc_id": r_doc_id,
            "page_number": int(r_page),
            "title": r_title,
            "filename": r_filename,
            "snippet": r_snippet
        })
        
        # Build context string
        context_blocks.append(
            f"--- DEBUT CONTEXTE ---\n"
            f"Document: {r_title} ({r_filename})\n"
            f"Page: {r_page}\n"
            f"Texte:\n{r_text}\n"
            f"--- FIN CONTEXTE ---"
        )

    # 2. Build Prompt
    prompt = (
        "Vous êtes un assistant IA spécialisé dans l'analyse de documents d'ingénierie et de rapports techniques.\n"
        "Répondez à la question de l'utilisateur de manière précise, concise et professionnelle.\n"
        "Pour chaque fait ou affirmation important, vous devez impérativement citer la source exacte "
        "sous la forme [Nom du document, page X] basée sur les informations du contexte.\n"
        "Basez-vous uniquement sur les extraits fournis ci-dessous. Si les informations fournies ne permettent pas "
        "de répondre ou si le contexte est insuffisant, répondez gentiment : "
        "'Je ne trouve pas de réponse à cette question dans les documents sélectionnés.' et n'inventez rien.\n\n"
        "Contexte de référence :\n"
    )
    
    if context_blocks:
        prompt += "\n\n".join(context_blocks)
    else:
        prompt += "(Aucun extrait de document trouvé pour cette question. Répondez que vous n'avez pas de contexte pour cette question.)"
        
    prompt += f"\n\nQuestion : {query}\n"
    prompt += "Réponse :"

    # 3. Call local Ollama generate API
    try:
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False
        }
        res = requests.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload, timeout=60.0)
        if res.status_code == 200:
            answer = res.json().get("response", "").strip()
            return {"answer": answer, "sources": sources}
        else:
            err_msg = res.text or f"Ollama API error {res.status_code}"
            return {"answer": f"Erreur de l'API Ollama : {err_msg}", "sources": []}
    except requests.exceptions.Timeout:
        return {"answer": "La requête vers l'assistant local Ollama a dépassé le délai d'attente (timeout de 60s).", "sources": []}
    except Exception as e:
        return {"answer": f"Impossible de contacter l'assistant local Ollama. Vérifiez qu'il est démarré sur http://127.0.0.1:11434. Erreur : {e}", "sources": []}
