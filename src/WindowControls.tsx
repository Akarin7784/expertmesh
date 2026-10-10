import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import type { DesktopWindowState } from '../shared/desktop';

export function WindowControls() {
  const desktop = window.expertmeshDesktop;
  const [state, setState] = useState<DesktopWindowState>({
    maximized: false,
    fullscreen: false,
    focused: true,
  });
  const [error, setError] = useState('');
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let receivedEvent = false;
    const update = (value: DesktopWindowState) => {
      if (active) setState(value);
    };
    const unsubscribe = desktop.onWindowState((value) => {
      receivedEvent = true;
      update(value);
    });
    desktop
      .getWindowState()
      .then((value) => {
        if (!receivedEvent) update(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktop]);
  useEffect(() => {
    if (!desktop) return;
    const root = document.documentElement;
    root.dataset.windowState = state.fullscreen
      ? 'fullscreen'
      : state.maximized
        ? 'maximized'
        : 'normal';
    root.dataset.windowFocused = String(state.focused);
    return () => {
      delete root.dataset.windowState;
      delete root.dataset.windowFocused;
    };
  }, [desktop, state]);
  if (!desktop) return null;
  const restored = state.maximized || state.fullscreen;
  const act = async (action: () => Promise<void>) => {
    setError('');
    try {
      await action();
    } catch {
      setError('窗口操作失败，请重试');
    }
  };
  return (
    <div className="window-controls" role="group" aria-label="窗口操作">
      {error && (
        <span className="window-control-error" role="alert">
          {error}
        </span>
      )}
      <button
        type="button"
        aria-label="最小化窗口"
        title="最小化"
        onClick={() => void act(desktop.minimize)}
      >
        <Minus size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={restored ? '还原窗口' : '最大化窗口'}
        title={restored ? '还原' : '最大化'}
        onClick={() => void act(desktop.toggleMaximize)}
      >
        {restored ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="window-close"
        aria-label="关闭窗口"
        title="关闭"
        onClick={() => void act(desktop.close)}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
