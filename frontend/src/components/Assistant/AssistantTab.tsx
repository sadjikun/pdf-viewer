import { useEffect, useRef, useState } from "react";
import { getOllamaStatus, queryQA } from "../../api";
import type { ChatMessage, OllamaStatus, QASource } from "../../types";
import "./AssistantTab.css";

interface Props {
  docId: string;
  gotoPage: (page: number) => void;
  openDocument: (docId: string, pageNumber?: number) => void;
}

export function AssistantTab({ docId, gotoPage, openDocument }: Props) {
  const [ollama, setOllama] = useState<OllamaStatus>({ available: false, models: [] });
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = sessionStorage.getItem(`chat_history:${docId}`);
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchLibrary, setSearchLibrary] = useState(false);
  const [checking, setChecking] = useState(true);

  const listEndRef = useRef<HTMLDivElement>(null);

  // Check Ollama status on mount
  useEffect(() => {
    let active = true;
    async function checkStatus() {
      try {
        const status = await getOllamaStatus();
        if (active) {
          setOllama(status);
          if (status.available && status.models.length > 0) {
            // Prefer qwen3.5:9b or llama3.2:1b if available, else first model
            const names = status.models.map(m => m.name);
            const preferred = names.find(n => n.includes("qwen") || n.includes("llama")) || names[0];
            setSelectedModel(preferred);
          }
        }
      } catch (e) {
        console.error("Failed to fetch Ollama status:", e);
      } finally {
        if (active) {
          setChecking(false);
        }
      }
    }
    checkStatus();
    return () => { active = false; };
  }, []);

  // Save chat history
  useEffect(() => {
    sessionStorage.setItem(`chat_history:${docId}`, JSON.stringify(messages));
  }, [messages, docId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const queryText = input.trim();
    setInput("");

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: "user",
      text: queryText,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await queryQA({
        query: queryText,
        doc_id: searchLibrary ? undefined : docId,
        model: selectedModel
      });

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: "assistant",
        text: res.answer,
        sources: res.sources,
        timestamp: Date.now()
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: "assistant",
        text: `Désolé, une erreur est survenue : ${err instanceof Error ? err.message : "Erreur inconnue."}`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleCitationClick = (source: QASource) => {
    if (source.doc_id === docId) {
      gotoPage(source.page_number);
    } else {
      openDocument(source.doc_id, source.page_number);
    }
  };

  const handleClear = () => {
    setMessages([]);
  };

  return (
    <div className="assistant-tab">
      {/* Ollama Status Header */}
      <div className="assistant-status-panel">
        {checking ? (
          <div className="assistant-status-item checking">
            <span className="status-dot pulsing" />
            <span>Vérification d'Ollama...</span>
          </div>
        ) : ollama.available ? (
          <div className="assistant-status-item connected">
            <span className="status-dot green" />
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="model-select"
              title="Modèle local Ollama"
            >
              {ollama.models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({Math.round(m.size / 1e9 * 10) / 10} GB)
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="assistant-status-warning">
            <div className="warning-title">
              <span className="status-dot red" />
              <strong>Ollama déconnecté</strong>
            </div>
            <p className="warning-text">
              Démarrez Ollama localement pour activer l'assistant offline :
            </p>
            <code className="warning-code">ollama run qwen3.5:9b</code>
          </div>
        )}
      </div>

      {/* Settings Row */}
      <div className="assistant-settings">
        <label className="assistant-toggle-label">
          <input
            type="checkbox"
            checked={searchLibrary}
            onChange={(e) => setSearchLibrary(e.target.checked)}
            className="assistant-checkbox"
          />
          <span>Interroger toute la bibliothèque</span>
        </label>
        {messages.length > 0 && (
          <button type="button" className="btn-clear-chat" onClick={handleClear}>
            Effacer l'historique
          </button>
        )}
      </div>

      {/* Chat Messages Area */}
      <div className="assistant-chat-history">
        {messages.length === 0 ? (
          <div className="assistant-welcome">
            <div className="welcome-icon">💬</div>
            <h3>Assistant de document local</h3>
            <p>
              Posez des questions sur le contenu de ce document (ou sur l'ensemble de votre bibliothèque en cochant l'option ci-dessus).
            </p>
            <p className="welcome-tip">
              Toutes les réponses sont sourcées et générées 100% localement.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`chat-bubble-wrapper ${msg.sender}`}>
              <div className={`chat-bubble ${msg.sender}`}>
                <div className="chat-text">{msg.text}</div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="chat-sources">
                    <span className="sources-label">Sources :</span>
                    <div className="sources-list">
                      {msg.sources.map((src, i) => (
                        <button
                          key={i}
                          type="button"
                          className="citation-pill"
                          onClick={() => handleCitationClick(src)}
                          title={`${src.title} - Page ${src.page_number}\n\n"${src.snippet.replace(/<[^>]+>/g, "")}"`}
                        >
                          {searchLibrary ? `${src.title.substring(0, 15)}..., p. ${src.page_number}` : `p. ${src.page_number}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="chat-bubble-wrapper assistant">
            <div className="chat-bubble assistant typing">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      {/* Input form */}
      <form onSubmit={handleSend} className="assistant-input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={ollama.available ? "Posez une question sur le document..." : "Ollama hors-ligne..."}
          disabled={!ollama.available || loading}
          className="assistant-input-field"
        />
        <button
          type="submit"
          disabled={!ollama.available || loading || !input.trim()}
          className="assistant-send-btn"
        >
          {loading ? "..." : "Envoyer"}
        </button>
      </form>
    </div>
  );
}
