import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { useLtl } from '../ltl/store';
import { askAgent, type ChatTurn } from './api';
import { buildSnapshot } from './snapshot';

const SUGGESTIONS = [
  'What is the total dead load and which assembly contributes most?',
  'Break down the psf of the floor assembly with the highest load.',
  'Which assemblies are not included or not finished yet?',
  'Summarize the lateral site results.',
];

interface Rect { x: number; y: number; w: number; h: number }
const MIN_W = 300;
const MIN_H = 280;
const MARGIN = 8;

const clampRect = (r: Rect): Rect => {
  const w = Math.min(Math.max(r.w, MIN_W), window.innerWidth - 2 * MARGIN);
  const h = Math.min(Math.max(r.h, MIN_H), window.innerHeight - 2 * MARGIN);
  return {
    w, h,
    x: Math.min(Math.max(r.x, MARGIN), window.innerWidth - w - MARGIN),
    y: Math.min(Math.max(r.y, MARGIN), window.innerHeight - h - MARGIN),
  };
};

const initialRect = (): Rect => {
  const w = 380;
  const h = Math.min(560, window.innerHeight - 90);
  return clampRect({ w, h, x: window.innerWidth - w - 20, y: window.innerHeight - h - 20 });
};

export default function AgentPanel() {
  const ltl = useLtl();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect>(initialRect);

  // Keep the window on screen when the browser is resized.
  useEffect(() => {
    const onResize = () => setRect((r) => clampRect(r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // mode 'move' drags by the header; 'resize' drags the bottom-right corner.
  const startDrag = (mode: 'move' | 'resize') => (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (mode === 'move' && (e.target as HTMLElement).closest('button'))) return;
    e.preventDefault();
    const start = { px: e.clientX, py: e.clientY, rect };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      setRect(
        clampRect(
          mode === 'move'
            ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
            : { ...start.rect, w: start.rect.w + dx, h: start.rect.h + dy },
        ),
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Rebuilt from live state at send time, so answers reflect the latest inputs and results.
  const snapshotNow = useMemo(() => () => buildSnapshot(ltl), [ltl]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy, open]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setInput('');
    setError('');
    setBusy(true);
    try {
      const answer = await askAgent(next, snapshotNow());
      setTurns([...next, { role: 'assistant', content: answer || '(empty answer)' }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant failed.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  if (!open) {
    return (
      <button className="agent-fab no-print" onClick={() => setOpen(true)} aria-label="Open assistant">
        <MessageCircle size={20} /> Ask
      </button>
    );
  }

  return (
    <aside className="agent-panel no-print" aria-label="Assistant" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <header className="agent-head" onPointerDown={startDrag('move')} title="Drag to move">
        <strong>Project assistant</strong>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant"><X size={16} /></button>
      </header>
      <div className="agent-body">
        {turns.length === 0 && (
          <div className="agent-empty">
            <p className="muted">Ask about your inputs or results: assemblies, materials, loads by level, or the lateral site report.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="agent-chip" onClick={() => void send(s)}>{s}</button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`agent-msg ${t.role}`}>{t.content}</div>
        ))}
        {busy && <div className="agent-msg assistant muted">Thinking…</div>}
        {error && <div className="agent-error">{error}</div>}
        <div ref={endRef} />
      </div>
      <form className="agent-form" onSubmit={onSubmit}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" disabled={busy} />
        <button className="btn primary" disabled={busy || !input.trim()} aria-label="Send"><Send size={16} /></button>
      </form>
      <div className="agent-resize" onPointerDown={startDrag('resize')} aria-label="Resize assistant" role="separator" />
    </aside>
  );
}
