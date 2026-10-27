/** Navigation only: never store inventory records, editor drafts, tokens, or permissions. */
export const navigationStorageKey = 'frc-4418-inventory-navigation-v1';
export type ListContext = {
  search: string; area: string; category: string; loc: string; stock: string; itemType: string; ownership: string;
  filtersOpen: boolean; audit?: boolean; scrollY: number; visited: boolean;
};
export const emptyListContext: ListContext = {
  search: '', area: '', category: '', loc: '', stock: '', itemType: '', ownership: '',
  filtersOpen: false, scrollY: 0, visited: false,
};
type Snapshot = {version: 1; userId: string; views: Record<string, ListContext>};
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const isListRoute = (route: string) => ['inventory', 'locations', 'restock'].includes(route) || /^location\/[a-zA-Z0-9_-]{1,128}$/.test(route);
function cleanContext(value: unknown): ListContext {
  const clean = {...emptyListContext};
  if (!value || typeof value !== 'object') return clean;
  const input = value as Record<string, unknown>;
  for (const key of ['search', 'area', 'category', 'loc', 'stock', 'itemType', 'ownership'] as const)
    if (typeof input[key] === 'string') clean[key] = input[key].slice(0, 500);
  for (const key of ['filtersOpen', 'visited'] as const) clean[key] = input[key] === true;
  if (typeof input.audit === 'boolean') clean.audit = input.audit;
  if (typeof input.scrollY === 'number' && Number.isFinite(input.scrollY)) clean.scrollY = Math.max(0, Math.min(input.scrollY, 10_000_000));
  return clean;
}

/** One account per tab. An auth transition invalidates even delayed writes from the old account. */
export function createNavigationContextStore(storage: () => StorageLike | undefined) {
  let snapshot: Snapshot | null = null;
  let activeUser: string | null = null;
  let initialized = false;
  const persist = () => {
    try {
      if (snapshot) storage()?.setItem(navigationStorageKey, JSON.stringify(snapshot));
      else storage()?.removeItem(navigationStorageKey);
    } catch { /* Private browsing/quota restrictions must not break navigation. */ }
  };
  return {
    activate(userId: string | null) {
      if (userId === activeUser && snapshot?.userId === userId) return;
      const mayHydrate = !initialized;
      initialized = true;
      activeUser = userId;
      snapshot = null;
      if (userId) {
        try {
          // Never resurrect a pre-signout view if browser storage removal was blocked.
          const saved = mayHydrate ? JSON.parse(storage()?.getItem(navigationStorageKey) || 'null') : null;
          if (saved?.version === 1 && saved.userId === userId && saved.views && typeof saved.views === 'object') {
            const views: Record<string, ListContext> = {};
            for (const [route, value] of Object.entries(saved.views).filter(([route]) => isListRoute(route)).slice(-100)) views[route] = cleanContext(value);
            snapshot = {version: 1, userId, views};
          }
        } catch { /* Corrupt or unavailable storage starts a fresh view. */ }
        snapshot ??= {version: 1, userId, views: {}};
      }
      persist();
    },
    read(userId: string, route: string): ListContext | undefined {
      const view = userId === activeUser && isListRoute(route) ? snapshot?.views[route] : undefined;
      return view ? {...view} : undefined;
    },
    update(userId: string, route: string, patch: Partial<ListContext>) {
      if (!snapshot || userId !== activeUser || !isListRoute(route)) return;
      const view = cleanContext({...snapshot.views[route], ...patch});
      delete snapshot.views[route];
      snapshot.views[route] = view;
      const oldest = Object.keys(snapshot.views)[0];
      if (Object.keys(snapshot.views).length > 100) delete snapshot.views[oldest];
      persist();
    },
  };
}
export const navigationContext = createNavigationContextStore(() => typeof window === 'undefined' ? undefined : window.sessionStorage);
