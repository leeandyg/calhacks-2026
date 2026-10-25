import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PixelIcon } from '../ui/PixelIcon.js';
import { useEnvironmentTheme } from '../ui/environmentTheme.js';

type PictureWindow = { requestWindow: (options: { width: number; height: number }) => Promise<Window> };
let pixelFont: Promise<ArrayBuffer> | undefined;

/** A portal keeps this window on the original controller, scene and microphone. */
export function useFloatingVoice(onClose: () => void) {
  const [floating, setFloating] = useState<Window>();
  const active = useRef<Window | undefined>(undefined);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => () => { const next = active.current; active.current = undefined; next?.close(); }, []);

  const open = async () => {
    if (active.current && !active.current.closed) { active.current.focus(); return; }
    const pip = (window as Window & { documentPictureInPicture?: PictureWindow }).documentPictureInPicture;
    const next = pip ? await pip.requestWindow({ width: 300, height: 240 })
      : window.open('', 'roomto-study-voice', 'popup,width=300,height=240');
    if (!next) throw new Error('Allow the floating voice window to open, then try again.');
    next.document.title = 'roomto.study';
    const base = next.document.createElement('base');
    base.href = document.baseURI;
    next.document.head.appendChild(base);
    for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) {
      if (style instanceof HTMLStyleElement) {
        const copy = next.document.createElement('style');
        // Transfer the bundled font separately: URL-backed faces can stall in about:blank windows.
        copy.textContent = style.textContent?.replace(/@font-face\s*\{[^}]*\}/g, '') ?? '';
        next.document.head.appendChild(copy);
      } else {
        const link = style as HTMLLinkElement;
        try {
          if (!link.sheet) throw new Error('Stylesheet is not ready');
          const copy = next.document.createElement('style');
          copy.textContent = [...link.sheet.cssRules].map(rule => rule.cssText).join('\n').replace(/@font-face\s*\{[^}]*\}/g, '');
          next.document.head.appendChild(copy);
        } catch {
          const copy = next.document.createElement('link');
          copy.rel = 'stylesheet'; copy.href = link.href;
          next.document.head.appendChild(copy);
        }
      }
    }
    next.document.body.className = 'floating-voice-body';
    pixelFont ??= fetch(new URL('/fonts/pixelify-sans.ttf', document.baseURI), { cache: 'force-cache' })
      .then(response => { if (!response.ok) throw new Error('Pixel font unavailable'); return response.arrayBuffer(); })
      .catch(error => { pixelFont = undefined; throw error; });
    void pixelFont.then(async data => {
      if (next.closed) return;
      const face = new FontFace('Pixelify Sans', data, { weight: '400 700', display: 'swap' });
      await face.load();
      if (!next.closed) next.document.fonts.add(face);
    }).catch(() => { /* Keep the readable monospace fallback if the local font is unavailable. */ });
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
  useEnvironmentTheme(target.document.documentElement);
  return createPortal(<section className="floating-voice-panel agent-controls" aria-label="Floating voice controls">
    <div className="floating-voice-header">
      <h1>roomto.study</h1>
      <button type="button" className="floating-close" aria-label="Close controls" title="Close controls" onClick={() => target.close()}><PixelIcon name="close"/></button>
    </div>
    <div className="floating-voice-content">{children}</div>
  </section>, target.document.body);
}
