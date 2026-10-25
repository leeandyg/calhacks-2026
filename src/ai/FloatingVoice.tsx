import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type PictureWindow = { requestWindow: (options: { width: number; height: number }) => Promise<Window> };

/** A portal keeps this window on the original controller, scene and microphone. */
export function useFloatingVoice(onClose: () => void) {
  const [floating, setFloating] = useState<Window>();
  const active = useRef<Window | undefined>(undefined);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => () => { const next = active.current; active.current = undefined; next?.close(); }, []);

  const open = async () => {
    if (active.current && !active.current.closed) { active.current.focus(); return; }
    const pip = (window as Window & { documentPictureInPicture?: PictureWindow }).documentPictureInPicture;
    const next = pip ? await pip.requestWindow({ width: 360, height: 300 })
      : window.open('', 'soundscape-voice', 'popup,width=360,height=300');
    if (!next) throw new Error('Allow the floating voice window to open, then try again.');
    next.document.title = 'Soundscape voice';
    for (const style of document.querySelectorAll('style, link[rel="stylesheet"]'))
      next.document.head.appendChild(style.cloneNode(true));
    next.document.body.className = 'floating-voice-body';
    active.current = next; setFloating(next);
    next.addEventListener('pagehide', () => {
      if (active.current !== next) return;
      active.current = undefined; setFloating(undefined); close.current();
    }, { once: true });
    if (!pip) next.document.body.dataset.standardWindow = 'true';
  };
  return { floating, open };
}

export function FloatingVoice({ window: target, children }: { window: Window; children: ReactNode }) {
  return createPortal(<section className="floating-voice-panel agent-controls" aria-label="Floating voice controls">
    <h1>Soundscape voice</h1>
    {children}
    {target.document.body.dataset.standardWindow && <p>This window stays separate. Keep it beside your homework.</p>}
    <button type="button" onClick={() => target.close()}>Close controls</button>
  </section>, target.document.body);
}
