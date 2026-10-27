import {useEffect, useRef, useState, type RefObject} from 'react';

import {createHashNavigation, type LeaveGuard} from './hash-navigation';
export type {LeaveGuard} from './hash-navigation';
export type LeaveGuardRef = RefObject<LeaveGuard | null>;

export function useGuardedHashRoute(guard: LeaveGuardRef, onNavigate: () => void) {
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'dashboard');
  const controller = useRef<ReturnType<typeof createHashNavigation> | null>(null);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  useEffect(() => {
    controller.current = createHashNavigation(window, () => guard.current, path => {
      setRoute(path);
      onNavigateRef.current();
    });
    return () => { controller.current?.dispose(); controller.current = null; };
  }, [guard]);
  const navigate = (path: string, onApproved?: () => void) => controller.current?.navigate(path, onApproved);
  return [route, navigate] as const;
}

export function useUnsavedChanges(dirty: boolean, busy: boolean, guard: LeaveGuardRef) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const request = (action: () => void) => {
    if (busy) return;
    if (pending) { setPending(() => action); return; }
    if (!dirty) { action(); return; }
    previousFocus.current = document.activeElement as HTMLElement | null;
    setPending(() => action);
  };
  const controller = useRef<LeaveGuard>({blocked: false, request});
  controller.current.blocked = dirty || busy;
  controller.current.request = request;
  guard.current = controller.current;
  useEffect(() => {
    guard.current = controller.current;
    return () => { if (guard.current === controller.current) guard.current = null; };
  }, [guard]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);
  useEffect(() => {
    if (pending) keepEditingRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      previousFocus.current?.focus();
    }
  }, [pending]);
  const keepEditing = () => { restoreFocus.current = true; setPending(null); };
  const confirmation = pending && <div className="modal-backdrop discard-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) keepEditing(); }}>
    <section className="modal discard-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); keepEditing(); }
      if (event.key === 'Tab') {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    }}>
      <h2 id="discard-title">Discard unsaved changes?</h2>
      <p id="discard-description">Your unfinished item changes have not been saved. Keep editing to finish them, or discard them to continue.</p>
      <div className="modal-actions">
        <button ref={keepEditingRef} type="button" className="primary" onClick={keepEditing}>Keep editing</button>
        <button type="button" className="secondary danger" onClick={() => { const action = pending; setPending(null); action(); }}>Discard changes</button>
      </div>
    </section>
  </div>;
  return {request, confirmation, confirming: !!pending};
}
