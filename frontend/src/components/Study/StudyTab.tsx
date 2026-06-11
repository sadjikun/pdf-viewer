import { useEffect, useState, useRef } from "react";
import { getStudyMetadata, saveStudyMetadata } from "../../api";
import type { StudyMetadata } from "../../types";
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
  
  const saveTimeoutRef = useRef<number | null>(null);

  // Load study metadata when docId changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
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
    return () => {
      active = false;
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [docId]);

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

  const handleChange = (field: keyof StudyMetadata, value: any) => {
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
            onChange={(e) => handleChange("status", e.target.value)}
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
            onChange={(e) => handleChange("priority", e.target.value)}
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
    </div>
  );
}
