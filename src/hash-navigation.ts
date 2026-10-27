export type LeaveGuard = {blocked: boolean; request: (action: () => void) => void};
const historyKey = 'inventoryRouteIndex';

type RouteBrowser = Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'>;

/** Own only this app's hash history. Canceling an edit must not replace or lose a Back/Forward entry. */
export function createHashNavigation(browser: RouteBrowser, getGuard: () => LeaveGuard | null, onNavigate: (route: string) => void) {
  const {history, location} = browser;
  const route = () => location.hash.slice(1) || 'dashboard';
  let index: number = history.state?.[historyKey] ?? 0;
  let restoring: (() => void) | null = null;
  let approvedTarget: number | null = null;
  let navigationVersion = 0;
  history.replaceState({...history.state, [historyKey]: index}, '', location.href);
  const signature = () => `${location.href}|${history.state?.[historyKey] ?? ''}`;
  let observed = signature();
  const changed = () => {
    // Browsers may report both events for one fragment transition, or a delayed no-op popstate.
    // Neither may dismiss the editor or repeat a pending history restoration.
    if (signature() === observed) return;
    const target: number = history.state?.[historyKey] ?? index + 1;
    // A plain # link creates an entry without state. Tag it before attempting to go back.
    if (history.state?.[historyKey] === undefined)
      history.replaceState({...history.state, [historyKey]: target}, '', location.href);
    observed = signature();
    if (restoring) {
      if (target !== index) { history.go(index - target); return; }
      const restored = restoring; restoring = null; restored(); return;
    }
    const difference = target - index;
    if (approvedTarget !== target && getGuard()?.blocked && difference !== 0) {
      const version = ++navigationVersion;
      restoring = () => {
        if (version !== navigationVersion) return;
        getGuard()?.request(() => {
          if (version !== navigationVersion) return;
          approvedTarget = target;
          history.go(target - index);
        });
      };
      history.go(-difference);
      return;
    }
    approvedTarget = null;
    index = target;
    onNavigate(route());
  };
  browser.addEventListener('popstate', changed);
  browser.addEventListener('hashchange', changed);
  return {
    navigate(path: string, onApproved?: () => void) {
      const version = ++navigationVersion;
      const proceed = () => {
        if (version !== navigationVersion) return;
        if (route() !== path) {
          index += 1;
          history.pushState({...history.state, [historyKey]: index}, '', `#${path}`);
        }
        observed = signature();
        onApproved?.();
        onNavigate(path);
      };
      const guard = getGuard();
      if (guard) guard.request(proceed); else proceed();
    },
    dispose() { browser.removeEventListener('popstate', changed); browser.removeEventListener('hashchange', changed); },
  };
}
