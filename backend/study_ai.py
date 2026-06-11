import json
import logging
import requests
from pathlib import Path
from search import CACHE_DIR, db_lock

log = logging.getLogger(__name__)

OLLAMA_BASE_URL = "http://127.0.0.1:11434"

def generate_ai_study_sheet(doc_id: str, model: str = "qwen3.5:9b") -> dict:
    """Aggregates highlights, queries Ollama LLM to generate summary/flashcards in JSON format, and caches the result."""
    doc_dir = CACHE_DIR / doc_id
    if not doc_dir.exists():
        raise FileNotFoundError("Document cache directory not found")

    annotations_path = doc_dir / "annotations.json"
    if not annotations_path.exists():
        raise ValueError("Aucun surlignage disponible (annotations.json inexistant)")

    try:
        store = json.loads(annotations_path.read_text(encoding="utf-8"))
    except Exception as e:
        log.error("Failed to load annotations.json: %s", e)
        raise ValueError("Impossible de lire les annotations.")

    highlights = store.get("highlights", []) or []
    if not highlights:
        raise ValueError("Aucun surlignage disponible dans ce document.")

    # 1. Format highlights
    lines = []
    for h in highlights:
        sec_title = h.get("sectionTitle") or "Sans section"
        page = h.get("page") or 1
        text = h.get("text", "").strip()
        if text:
            lines.append(f"- Section: {sec_title} (Page {page})\n  Texte: {text}")

    highlights_text = "\n\n".join(lines)
    if not highlights_text.strip():
        raise ValueError("Les surlignages ne contiennent pas de texte valide.")

    # 2. Build Prompt
    prompt = (
        "Vous êtes un assistant pédagogique de révision.\n"
        "Voici une liste de passages textuels surlignés par l'utilisateur dans un document d'étude.\n"
        "Générez une fiche d'apprentissage comprenant :\n"
        "1. Un résumé (summary) structuré et synthétique en Markdown.\n"
        "2. Une liste de 5 à 10 flashcards (mémo-fiches) Question/Réponse couvrant les points essentiels.\n\n"
        "RÉFÉRENCE DES SURLIGNAGES :\n"
        f"{highlights_text}\n\n"
        "INSTRUCTIONS DE SORTIE :\n"
        "Vous devez impérativement répondre par un objet JSON valide contenant exactement ces deux clés :\n"
        "- 'summary': (chaîne de caractères) le résumé rédigé en Markdown.\n"
        "- 'flashcards': (liste d'objets) chaque objet ayant les clés 'question' et 'answer'.\n\n"
        "Format JSON attendu :\n"
        "{\n"
        "  \"summary\": \"## Résumé des notions...\\n\\n- Notion 1...\",\n"
        "  \"flashcards\": [\n"
        "    {\"question\": \"Quelle est la valeur de...?\", \"answer\": \"La valeur est...\"}\n"
        "  ]\n"
        "}\n"
    )

    # 3. Request local Ollama in JSON format
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json"
    }

    try:
        res = requests.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload, timeout=90.0)
        if res.status_code != 200:
            err_msg = res.text or f"Ollama API error {res.status_code}"
            raise Exception(f"Erreur Ollama : {err_msg}")

        response_text = res.json().get("response", "").strip()
        
        # Extract JSON from potential markdown code block or noise
        clean_json_text = response_text
        import re
        # Try finding markdown code block first
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", response_text, re.DOTALL | re.IGNORECASE)
        if match:
            clean_json_text = match.group(1).strip()
        else:
            # Fallback: find first { and last }
            first_bracket = response_text.find('{')
            last_bracket = response_text.rfind('}')
            if first_bracket != -1 and last_bracket != -1 and last_bracket > first_bracket:
                clean_json_text = response_text[first_bracket:last_bracket+1].strip()

        data = json.loads(clean_json_text)

        if "summary" not in data or "flashcards" not in data:
            raise ValueError("Le JSON retourné par Ollama ne respecte pas le schéma (clés 'summary' ou 'flashcards' manquantes).")

        # Save to disk cache
        fiche_path = doc_dir / "fiche_ai.json"
        with open(fiche_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        return data

    except requests.exceptions.Timeout:
        raise Exception("La requête vers l'assistant local Ollama a dépassé le délai d'attente (timeout de 90s).")
    except json.JSONDecodeError as je:
        log.error("Failed to parse Ollama JSON response: %s\nResponse was: %s", je, response_text)
        raise Exception("L'assistant local a retourné un JSON invalide. Veuillez réessayer.")
    except Exception as e:
        log.error("Ollama study sheet generation failed: %s", e)
        raise Exception(f"Impossible de générer la fiche d'étude. Erreur : {e}")
