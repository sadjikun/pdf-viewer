import array
import json
import logging
import math
import re
import sqlite3
import requests
from pathlib import Path
from search import get_db_connection, db_lock

log = logging.getLogger(__name__)

OLLAMA_BASE_URL = "http://127.0.0.1:11434"
DEFAULT_EMBED_MODEL = "nomic-embed-text"

def init_vector_db() -> None:
    """Initialise la table des embeddings vectoriels dans search_index.db."""
    with db_lock:
        with get_db_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS page_embeddings (
                    doc_id TEXT,
                    page_number INTEGER,
                    embedding BLOB,
                    PRIMARY KEY (doc_id, page_number)
                )
            """)
            conn.commit()

def serialize_vector(vector: list[float]) -> bytes:
    """Convertit une liste de réels en blob binaire compact."""
    return array.array('f', vector).tobytes()

def deserialize_vector(blob: bytes) -> list[float]:
    """Convertit un blob binaire compact en liste de réels."""
    a = array.array('f')
    a.frombytes(blob)
    return list(a)

def get_ollama_models() -> list[str]:
    """Retourne la liste des noms de modèles disponibles localement sur Ollama."""
    try:
        res = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2.0)
        if res.status_code == 200:
            return [m.get("name") for m in res.json().get("models", []) if m.get("name")]
    except Exception:
        pass
    return []

def get_embedding(text: str, preferred_model: str = DEFAULT_EMBED_MODEL) -> list[float]:
    """Appelle Ollama pour obtenir l'embedding d'un texte, avec replis automatiques."""
    if not text or not text.strip():
        return []

    # Liste des modèles candidats à essayer
    candidates = [preferred_model]
    
    # Récupérer les modèles installés pour trouver un repli si le préféré manque
    installed = get_ollama_models()
    if preferred_model not in installed:
        # Essayer un autre modèle d'embedding connu
        for m in installed:
            if "embed" in m:
                candidates.append(m)
        # Sinon, essayer n'importe quel modèle disponible
        candidates.extend(installed)

    # Filtrer les doublons tout en gardant l'ordre
    unique_candidates = []
    for c in candidates:
        if c not in unique_candidates:
            unique_candidates.append(c)

    for model in unique_candidates:
        # Essayer d'abord l'API moderne /api/embed
        try:
            payload = {"model": model, "input": text}
            res = requests.post(f"{OLLAMA_BASE_URL}/api/embed", json=payload, timeout=8.0)
            if res.status_code == 200:
                embeds = res.json().get("embeddings", [])
                if embeds and len(embeds) > 0:
                    return embeds[0]
        except Exception:
            pass

        # Repli vers l'ancienne API /api/embeddings
        try:
            payload = {"model": model, "prompt": text}
            res = requests.post(f"{OLLAMA_BASE_URL}/api/embeddings", json=payload, timeout=8.0)
            if res.status_code == 200:
                vector = res.json().get("embedding", [])
                if vector:
                    return vector
        except Exception:
            pass

    log.warning("Impossible de générer l'embedding pour le texte. Aucun modèle Ollama fonctionnel ou disponible.")
    return []

def index_document_vectors(doc_id: str, model: str = DEFAULT_EMBED_MODEL) -> None:
    """Génère et stocke les embeddings pour chaque page d'un document."""
    init_vector_db()
    
    # 1. Récupérer le texte de chaque page à partir du FTS5
    pages: list[tuple[int, str]] = []
    with db_lock:
        try:
            with get_db_connection() as conn:
                cur = conn.execute(
                    "SELECT page_number, text FROM document_pages WHERE doc_id = ?",
                    (doc_id,)
                )
                pages = cur.fetchall()
        except sqlite3.OperationalError as e:
            log.error("FTS5 table query failed while vector indexing: %s", e)
            return

    if not pages:
        log.info("Aucun texte trouvé pour le document %s, indexation vectorielle sautée.", doc_id)
        return

    log.info("Indexation sémantique en cours pour %s (%d pages)...", doc_id, len(pages))
    
    # Supprimer les anciens embeddings s'il y en a
    with db_lock:
        with get_db_connection() as conn:
            conn.execute("DELETE FROM page_embeddings WHERE doc_id = ?", (doc_id,))
            conn.commit()

    indexed_count = 0
    for page_num, text in pages:
        # On limite le texte de la page pour ne pas surcharger le LLM d'embeddings
        snippet = text[:4000] if len(text) > 4000 else text
        vector = get_embedding(snippet, preferred_model=model)
        if vector:
            blob = serialize_vector(vector)
            with db_lock:
                with get_db_connection() as conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO page_embeddings (doc_id, page_number, embedding) VALUES (?, ?, ?)",
                        (doc_id, page_num, blob)
                    )
                    conn.commit()
            indexed_count += 1

    log.info("Indexation sémantique terminée pour %s : %d/%d pages indexées avec succès.", doc_id, indexed_count, len(pages))

def magnitude(v: list[float]) -> float:
    return math.sqrt(sum(x * x for x in v))

def dot_product(v1: list[float], v2: list[float]) -> float:
    return sum(x * y for x, y in zip(v1, v2))

def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    mag1 = magnitude(v1)
    mag2 = magnitude(v2)
    if mag1 == 0.0 or mag2 == 0.0:
        return 0.0
    return dot_product(v1, v2) / (mag1 * mag2)

def search_semantic(query: str, preferred_model: str = DEFAULT_EMBED_MODEL, limit: int = 20) -> list[dict]:
    """Recherche les pages les plus similaires sémantiquement à la requête."""
    init_vector_db()
    
    query_vector = get_embedding(query, preferred_model=preferred_model)
    if not query_vector:
        log.warning("Impossible de lancer la recherche sémantique : échec de calcul de l'embedding de la requête.")
        return []

    # Récupérer tous les embeddings de la base de données
    rows = []
    with db_lock:
        try:
            with get_db_connection() as conn:
                cur = conn.execute("""
                    SELECT pe.doc_id, pe.page_number, pe.embedding, d.title, d.filename, 
                           (SELECT text FROM document_pages WHERE doc_id = pe.doc_id AND page_number = pe.page_number) as text
                    FROM page_embeddings pe
                    JOIN documents d ON d.doc_id = pe.doc_id
                """)
                rows = cur.fetchall()
        except Exception as e:
            log.error("Erreur lors de la récupération des embeddings : %s", e)
            return []

    # Calculer les similarités
    scores = []
    for doc_id, page_number, blob, title, filename, text in rows:
        try:
            page_vector = deserialize_vector(blob)
            if len(page_vector) == len(query_vector):
                sim = cosine_similarity(query_vector, page_vector)
                if sim > 0.35: # Seuil minimum de pertinence sémantique
                    scores.append({
                        "doc_id": doc_id,
                        "page_number": int(page_number),
                        "similarity": sim,
                        "title": title,
                        "filename": filename,
                        "text": text or ""
                    })
        except Exception as e:
            log.warning("Échec du calcul de similarité pour %s p.%s: %s", doc_id, page_number, e)

    # Trier par similarité décroissante
    scores.sort(key=lambda x: x["similarity"], reverse=True)
    top_matches = scores[:limit]

    # Convertir au format attendu par le frontend en créant des snippets textuels
    results = []
    for match in top_matches:
        text = match["text"]
        snippet = ""
        # Création simplifiée de snippet autour de termes proches ou début du texte
        words = query.lower().split()
        match_idx = -1
        for word in words:
            if len(word) > 3:
                match_idx = text.lower().find(word)
                if match_idx != -1:
                    break
        if match_idx != -1:
            start_idx = max(0, match_idx - 60)
            end_idx = min(len(text), match_idx + 140)
            snippet = ("..." if start_idx > 0 else "") + text[start_idx:end_idx] + ("..." if end_idx < len(text) else "")
        else:
            snippet = text[:200] + ("..." if len(text) > 200 else "")

        # Formater les mots clés recherchés en gras dans le snippet
        for word in words:
            if len(word) > 2:
                pattern = re.compile(re.escape(word), re.IGNORECASE)
                snippet = pattern.sub(lambda m: f"<b>{m.group(0)}</b>", snippet)

        results.append({
            "doc_id": match["doc_id"],
            "page_number": match["page_number"],
            "snippet": snippet,
            "title": match["title"],
            "filename": match["filename"],
            "score": round(match["similarity"], 3)
        })

    return results
