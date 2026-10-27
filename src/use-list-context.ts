import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {emptyListContext, isListRoute, navigationContext, type ListContext} from './navigation-context';

export function useListContext(userId: string, route: string, defaults: Partial<ListContext> = {}) {
  const [context, setContext] = useState<ListContext>(() => {
    const initial = {...emptyListContext, ...defaults, ...navigationContext.read(userId, route)};
    navigationContext.update(userId, route, initial);
    return initial;
  });
  const update = (patch: Partial<ListContext>) => {
    setContext(current => ({...current, ...patch}));
    navigationContext.update(userId, route, patch);
  };
  return [context, update] as const;
}

/** Restore after the list is mounted, not while the authenticated workspace is still loading. */
export function useListScroll(userId: string, route: string) {
  const acceptedRoute = useRef(route);
  const capture = useCallback(() => {
    if (isListRoute(acceptedRoute.current)) navigationContext.update(userId, acceptedRoute.current, {scrollY: window.scrollY});
  }, [userId]);
  useLayoutEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    window.addEventListener('scroll', capture, {passive: true});
    window.addEventListener('pagehide', capture);
    return () => {
      window.removeEventListener('scroll', capture);
      window.removeEventListener('pagehide', capture);
      history.scrollRestoration = previous;
    };
  }, [capture]);
  useLayoutEffect(() => {
    acceptedRoute.current = route;
    const saved = navigationContext.read(userId, route);
    if (isListRoute(route)) navigationContext.update(userId, route, {visited: true});
    window.scrollTo({top: saved?.scrollY ?? 0, behavior: 'instant'});
  }, [route, userId]);
  return capture;
}
