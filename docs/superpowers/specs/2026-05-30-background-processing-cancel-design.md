# Background Processing + Cancel Design

**Date:** 2026-05-30  
**Status:** Approved

## Summary

Add a "Stop treatment" button and make processing non-blocking so users can browse the library and open already-processed documents while a new document is being treated in the background.

---

## Section 1 — Backend

### Cancel event in active_tasks

Each entry in `active_tasks` gains a `cancel_event: threading.Event` field alongside `status`, `progress`, and `message`.

```python
active_tasks[doc_id] = {
    "status": "processing",
    "progress": 0,
    "message": "...",
    "cancel_event": threading.Event(),
}
```

### New endpoint: POST /doc/{doc_id}/cancel

- Sets `cancel_event` for the running task.
- Returns `{"status": "cancelled"}` immediately — does not wait for the thread to stop.
- If `doc_id` is not in `active_tasks`, returns 404.

### Pipeline cancellation (pipeline.py)

`run_pipeline_bg` wraps the progress callback: before forwarding a `(progress, message)` call to `update_task_progress`, it checks `cancel_event.is_set()`. If set, it raises `CancelledError`.

This means the pipeline checks for cancellation at every `progress_callback(p, m)` call with no changes required deep inside `convertir_pdf` / `convertir_generic`.

On `CancelledError` in `run_pipeline_bg`:
- Delete partial output files (HTML chunks, figure PNGs, `result.json` if partially written).
- Keep the source PDF (`source.pdf` / `source.xxx`) intact.
- Write no `error.json` (this is a user-initiated cancel, not an error).
- Set `active_tasks[doc_id]["status"] = "cancelled"` and keep the entry for 2 seconds, then remove it — this lets the frontend detect the cancelled state on its next poll.

### GET /doc/{doc_id}/status

Already exists. Must return `"cancelled"` status when the task entry has `status == "cancelled"`, so the frontend knows to stop polling.

---

## Section 2 — Frontend State & Non-Blocking Navigation

### Replace loading boolean with processingDocs map

```ts
type ProcessingEntry = { progress: number; message: string; filename: string };
const [processingDocs, setProcessingDocs] = useState<Map<string, ProcessingEntry>>(new Map());
```

Store interval IDs so they can be cleared on cancel:
```ts
const pollingIntervals = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
```

- `startPolling(docId, filename)` adds an entry to `processingDocs` and stores its `intervalId` in `pollingIntervals`.
- On each poll: update the entry's `progress` and `message`.
- When status is `ready` / `failed` / `cancelled` / `not_found`: clear the interval from `pollingIntervals`, remove the entry from `processingDocs`, and handle accordingly.
  - `ready` → `setDoc(result)` if this was the awaited upload, `refreshLibrary()`
  - `failed` → `setError(...)`, `refreshLibrary()`
  - `cancelled` → silently remove (user already clicked Stop); `refreshLibrary()`
  - `not_found` → silently remove; `refreshLibrary()`
- The full-screen `LoadingDocling` overlay only renders when `processingDocs.size > 0 && !doc` (i.e., the user has nothing else to view). If the user already has a document open, the overlay never appears.
- `handleFile` and `handleReprocess` no longer force `doc = null`. The user keeps viewing their current document until the new one is ready (for reprocess, `doc` is cleared only when the result comes back ready).

### Non-blocking upload

When `handleFile` gets `status: "processing"` back from the server, it calls `startPolling` but does NOT call `setDoc(null)` if a doc is already open.

When `handleReprocess` gets `status: "processing"`, `doc` is set to `null` only after `setDoc(result)` receives the ready result — not at the start of polling.

---

## Section 3 — New UI Components

### ProcessingToast (floating mini-bar)

**File:** `frontend/src/components/Processing/ProcessingToast.tsx`

- Fixed position, bottom-center, `z-index` above sidebar and main content.
- Receives `processingDocs: Map<string, ProcessingEntry>` and `onCancel: (docId: string) => void`.
- One row per processing doc:
  ```
  [filename truncated]  [████░░░ 42%]  [Arrêter]
  ```
- Multiple concurrent docs → stacked rows (max visible height capped, scrollable).
- "Arrêter" calls `cancelDoc(docId)` (API) then immediately calls `onCancel(docId)` to remove the entry from `processingDocs` and clear its polling interval (optimistic UI — no waiting for backend confirmation).
- Renders `null` when the map is empty.
- Styled with CSS variables from the active theme (no hardcoded colors).

**File:** `frontend/src/components/Processing/ProcessingToast.css`

### Library card badges

- `Library` component receives a new prop: `processingDocs: Map<string, ProcessingEntry>`.
- For any card whose `doc_id` is in the map: overlay a spinning badge showing `XX%` and the current message.
- The "Lancer le traitement IA" and "Retraiter" buttons are hidden/disabled while that doc is processing.
- When the entry is removed from the map, the badge disappears and the card reflects the new state on the next `refreshLibrary` call.

### api.ts addition

```ts
export async function cancelDoc(docId: string): Promise<void> {
  await apiFetch(`/doc/${docId}/cancel`, { method: "POST" });
}
```

---

## Data Flow

```
User uploads PDF
  → handleFile → processPdf API
  → if processing: startPolling(docId, filename) → adds to processingDocs
  → poll every 1500ms → updates processingDocs entry
  → ProcessingToast shows progress
  → Library card shows badge

User clicks "Arrêter"
  → cancelDoc(docId) → POST /doc/{docId}/cancel
  → onCancel(docId) → removes from processingDocs immediately
  → backend: cancel_event.set() → pipeline raises CancelledError
  → partial files deleted, source PDF kept
  → doc stays in library as "registered"

Poll detects "ready"
  → remove from processingDocs
  → setDoc(result) if this was the active upload
  → refreshLibrary()
```

---

## Files Changed

| File | Change |
|------|--------|
| `backend/main.py` | Add `cancel_event` to `active_tasks`; add `POST /doc/{id}/cancel`; return `"cancelled"` in status endpoint; wrap progress callback in `run_pipeline_bg` |
| `frontend/src/api.ts` | Add `cancelDoc()` |
| `frontend/src/App.tsx` | Replace `loading` with `processingDocs` map; update `startPolling`; pass props to `ProcessingToast` and `Library` |
| `frontend/src/components/Processing/ProcessingToast.tsx` | New component |
| `frontend/src/components/Processing/ProcessingToast.css` | New styles |
| `frontend/src/components/Library/Library.tsx` | Accept `processingDocs` prop; show badge on processing cards |

---

## Constraints

- No changes deep inside `pipeline.py` pipeline logic — cancellation is entirely handled via the progress callback wrapper in `run_pipeline_bg`.
- The `loading` state variable is removed; `libraryLoading` is kept as-is.
- The full-screen `LoadingDocling` overlay is kept for the empty state (no doc open, new doc being processed for the first time).
- FIX-047 (parallel pipeline batches) and FIX-048 (pypdfium2 thread-safety lock) must not be disturbed.
