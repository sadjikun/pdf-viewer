import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { getStudyMetadata, saveStudyMetadata, getOllamaStatus, getFicheAI, generateFicheAI, getAnnotations } from "../../api";
import type { StudyMetadata, FicheAIResponse, OllamaStatus } from "../../types";
import "./StudyTab.css";

interface Props {
  docId: string;
  onMetadataChange?: () => void;
}

export function StudyTab({ docId, onMetadataChange }: Props) {
  const [metadata, setMetadata] = useState<StudyMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  
  const [ollama, setOllama] = useState<OllamaStatus>({ available: false, models: [] });
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [ficheAI, setFicheAI] = useState<FicheAIResponse | null>(null);
  const [highlightsCount, setHighlightsCount] = useState(0);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [revealedCards, setRevealedCards] = useState<Record<number, boolean>>({});
  
  const saveTimeoutRef = useRef<number | null>(null);

  // Load study metadata, annotations count, AI fiche and Ollama status when docId changes
  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setAiError(null);
    setFicheAI(null);
    setRevealedCards({});

    // 1. Fetch metadata
    getStudyMetadata(docId)
      .then((data) => {
        if (active) {
          setMetadata(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("Impossible de charger les métadonnées d'étude.");
          setLoading(false);
        }
      });

    // 2. Check highlights count
    getAnnotations(docId)
      .then((ann) => {
        if (active) {
          setHighlightsCount(ann.highlights?.length ?? 0);
        }
      })
      .catch((e) => {
        console.error("Failed to load highlights:", e);
        if (active) setHighlightsCount(0);
      });

    // 3. Fetch existing AI study sheet
    getFicheAI(docId)
      .then((fiche) => {
        if (active) {
          setFicheAI(fiche);
        }
      })
      .catch((e) => {
        console.error("Failed to fetch AI study sheet:", e);
      });

    // 4. Fetch Ollama status
    getOllamaStatus()
      .then((status) => {
        if (active) {
          setOllama(status);
          if (status.available && status.models.length > 0) {
            const names = status.models.map((m) => m.name);
            const preferred = names.find((n) => n.includes("qwen") || n.includes("llama")) || names[0];
            setSelectedModel(preferred);
          }
        }
      })
      .catch((e) => {
        console.error("Failed to check Ollama status:", e);
      });

    return () => {
      active = false;
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [docId]);

  const handleGenerateAI = async () => {
    if (generatingAI) return;
    setGeneratingAI(true);
    setAiError(null);
    try {
      // Reload annotations count just in case
      const ann = await getAnnotations(docId);
      const count = ann.highlights?.length ?? 0;
      setHighlightsCount(count);
      if (count === 0) {
        throw new Error("Aucun surlignage disponible. Veuillez d'abord surligner du texte.");
      }
      
      const res = await generateFicheAI(docId, selectedModel);
      setFicheAI(res);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Erreur de génération.");
    } finally {
      setGeneratingAI(false);
    }
  };

  const toggleCard = (idx: number) => {
    setRevealedCards((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Debounced auto-save function
  const triggerAutoSave = (updated: StudyMetadata) => {
    setMetadata(updated);
    setSaving(true);
    
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await saveStudyMetadata(docId, updated);
        setSaving(false);
        onMetadataChange?.();
      } catch {
        setError("Erreur lors de la sauvegarde automatique.");
        setSaving(false);
      }
    }, 800); // 800ms debounce
  };

  const handleChange = <K extends keyof StudyMetadata>(field: K, value: StudyMetadata[K]) => {
    if (!metadata) return;
    const updated = { ...metadata, [field]: value };
    triggerAutoSave(updated);
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!metadata) return;
    const tag = newTag.trim();
    if (!tag || metadata.tags.includes(tag)) return;
    const updated = { ...metadata, tags: [...metadata.tags, tag] };
    setNewTag("");
    triggerAutoSave(updated);
  };

  const handleRemoveTag = (tag: string) => {
    if (!metadata) return;
    const updated = { ...metadata, tags: metadata.tags.filter((t) => t !== tag) };
    triggerAutoSave(updated);
  };

  if (loading) {
    return (
      <div className="study-tab study-tab--loading">
        <div className="study-skeleton-line" style={{ width: "80%", height: "24px" }} />
        <div className="study-skeleton-line" style={{ width: "100%", height: "40px" }} />
        <div className="study-skeleton-line" style={{ width: "60%", height: "24px" }} />
        <div className="study-skeleton-line" style={{ width: "100%", height: "40px" }} />
      </div>
    );
  }

  if (error && !metadata) {
    return <div className="study-tab-error">{error}</div>;
  }

  if (!metadata) return null;

  return (
    <div className="study-tab">
      <div className="study-tab-header">
        <h3>Statut d'étude</h3>
        {saving && <span className="study-saving-badge">Sauvegarde…</span>}
      </div>

      {error && <div className="study-alert-error">{error}</div>}

      <div className="study-field-group">
        <label htmlFor="study-subject">Matière / Sujet</label>
        <input
          id="study-subject"
          type="text"
          value={metadata.subject}
          onChange={(e) => handleChange("subject", e.target.value)}
          placeholder="Ex : Béton Armé, Physique Quantique…"
          className="study-input"
        />
      </div>

      <div className="study-field-group">
        <label htmlFor="study-folder">Dossier bibliothèque</label>
        <input
          id="study-folder"
          type="text"
          value={metadata.folder}
          onChange={(e) => handleChange("folder", e.target.value)}
          placeholder="Ex : Cours/M1, Projets/TPE (séparez par /)"
          className="study-input"
        />
        <small className="study-help">Utilisez des slashes pour imbriquer des dossiers.</small>
      </div>

      <div className="study-grid-row">
        <div className="study-field-group">
          <label htmlFor="study-status">Statut de lecture</label>
          <select
            id="study-status"
            value={metadata.status}
            onChange={(e) => handleChange("status", e.target.value as StudyMetadata["status"])}
            className="study-select"
          >
            <option value="todo">À lire 📖</option>
            <option value="in_progress">En cours ⚡</option>
            <option value="done">Lu ✅</option>
          </select>
        </div>

        <div className="study-field-group">
          <label htmlFor="study-priority">Priorité d'étude</label>
          <select
            id="study-priority"
            value={metadata.priority}
            onChange={(e) => handleChange("priority", e.target.value as StudyMetadata["priority"])}
            className="study-select"
          >
            <option value="low">Basse 🟡</option>
            <option value="medium">Moyenne 🟠</option>
            <option value="high">Haute 🔴</option>
          </select>
        </div>
      </div>

      <div className="study-field-group">
        <label>Tags d'étude</label>
        <form onSubmit={handleAddTag} className="study-tag-form">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Ajouter un tag…"
            className="study-input"
          />
          <button type="submit" className="study-tag-add-btn">+</button>
        </form>

        <div className="study-tags-list">
          {metadata.tags.map((tag) => (
            <span key={tag} className="study-tag-pill">
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                title="Supprimer le tag"
              >
                &times;
              </button>
            </span>
          ))}
          {metadata.tags.length === 0 && (
            <p className="study-tags-empty">Aucun tag défini.</p>
          )}
        </div>
      </div>

      <div className="study-divider" />

      <div className="study-ai-section">
        <div className="study-ai-header">
          <h4>Fiche de Révision IA</h4>
          {generatingAI && <span className="study-generating-badge">Génération…</span>}
        </div>

        {aiError && <div className="study-alert-error">{aiError}</div>}

        {/* 1. Connection check / Setup warnings */}
        {!ollama.available && !ficheAI && (
          <div className="study-ai-warning">
            <span className="warning-title">⚠️ Ollama requis</span>
            <p>Démarrez Ollama en local pour générer des fiches de révision et des flashcards d'apprentissage automatiques à partir de vos surlignages.</p>
          </div>
        )}

        {/* 2. No highlights warning */}
        {highlightsCount === 0 && !ficheAI && (
          <div className="study-ai-empty">
            <p>Surlignez des passages du texte dans le document pour pouvoir générer une fiche IA.</p>
          </div>
        )}

        {/* 3. Has highlights, ready to generate */}
        {highlightsCount > 0 && !ficheAI && !generatingAI && (
          <div className="study-ai-prompt">
            <p>Vous avez surligné <strong>{highlightsCount}</strong> passage{highlightsCount > 1 ? "s" : ""}. Prêt à générer la fiche de révision et les flashcards IA.</p>
            {ollama.available && (
              <div className="study-ai-actions">
                <div className="study-model-select-wrapper">
                  <label htmlFor="ai-model-select">Modèle LLM :</label>
                  <select
                    id="ai-model-select"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="study-select"
                  >
                    {ollama.models.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="study-ai-btn" onClick={handleGenerateAI}>
                  Générer la fiche IA
                </button>
              </div>
            )}
          </div>
        )}

        {/* 4. Generating state */}
        {generatingAI && (
          <div className="study-ai-loading">
            <div className="spinner" />
            <p>L'assistant local analyse vos surlignages et rédige la fiche de révision...</p>
          </div>
        )}

        {/* 5. Render sheet content */}
        {ficheAI && !generatingAI && (
          <div className="study-ai-content">
            {/* Header / Actions */}
            <div className="study-ai-content-header">
              {ollama.available && highlightsCount > 0 && (
                <div className="study-ai-regenerate-wrapper">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="study-select study-select-sm"
                    aria-label="Modèle local"
                  >
                    {ollama.models.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="study-ai-btn-secondary" onClick={handleGenerateAI}>
                    Régénérer
                  </button>
                </div>
              )}
            </div>

            {/* AI Summary Section */}
            <div className="study-ai-summary-card">
              <h5>Résumé de l'IA</h5>
              <div className="study-ai-summary-text">
                <ReactMarkdown>{ficheAI.summary}</ReactMarkdown>
              </div>
            </div>

            {/* Flashcards Section */}
            {ficheAI.flashcards && ficheAI.flashcards.length > 0 && (
              <div className="study-ai-flashcards-section">
                <h5>Flashcards d'auto-évaluation ({ficheAI.flashcards.length})</h5>
                <p className="study-help-text">Cliquez sur une carte pour révéler la réponse.</p>
                <div className="study-flashcards-grid">
                  {ficheAI.flashcards.map((card, idx) => {
                    const isRevealed = !!revealedCards[idx];
                    return (
                      <div
                        key={idx}
                        className={`study-flashcard-card ${isRevealed ? "is-revealed" : ""}`}
                        onClick={() => toggleCard(idx)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleCard(idx); }}
                      >
                        <div className="study-flashcard-inner">
                          <div className="study-flashcard-front">
                            <div className="study-flashcard-tag">Question {idx + 1}</div>
                            <p>{card.question}</p>
                          </div>
                          <div className="study-flashcard-back">
                            <div className="study-flashcard-tag">Réponse</div>
                            <p>{card.answer}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
