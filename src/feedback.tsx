import {useEffect, useRef, type ReactNode} from 'react';
import {Package} from 'lucide-react';

export interface ReadFailure {
 kind: 'connection' | 'permission' | 'session' | 'other';
 title: string;
 message: string;
}

// A failed read is not an empty result. Do not display raw server details, which
// may contain internal identifiers or unrelated data, or suggest a write retry.
export function readFailure(error: unknown): ReadFailure {
 const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
 const detail = `${record.code ?? ''} ${record.message ?? (typeof error === 'string' ? error : '')}`;
 if (/JWT|session|refresh.token|PGRST30[123]/i.test(detail)) return {kind: 'session', title: 'Sign in again to refresh inventory', message: 'Your session could not be verified. Sign out and sign in again. If this continues, ask your mentor to check your account.'};
 if (/42501|permission|row.level|not allowed|forbidden/i.test(detail)) return {kind: 'permission', title: 'Inventory access needs attention', message: 'Your account could not load this inventory. Ask your lead or mentor to check your access, then retry. This is not an empty inventory result.'};
 if (/fetch|network|offline|connection/i.test(detail)) return {kind: 'connection', title: 'Could not connect to inventory', message: 'Check your connection and retry. No inventory results have been replaced.'};
 return {kind: 'other', title: 'Could not load inventory', message: 'The workspace did not return inventory successfully. Retry, or ask your lead or mentor for help if this continues.'};
}

export function ReadError({failure, retry, retrying = false, cached = false, accessBlocked = false}: {failure: ReadFailure; retry: () => void; retrying?: boolean; cached?: boolean; accessBlocked?: boolean}) {
 const retryButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(accessBlocked)retryButton.current?.focus();},[accessBlocked]);
 return <section className="read-error" role="alert" aria-label={failure.title}>
  <div><h2>{failure.title}</h2><p>{failure.message}</p>{accessBlocked&&<p>Inventory is hidden until access is verified. Unfinished item edits are kept in this tab.</p>}<p>{cached?'Showing the last successfully loaded inventory; it may be out of date. ':''}Your search and filters are kept when you retry.</p></div>
  <button ref={retryButton} className="secondary" disabled={retrying} onClick={retry}>{retrying?'Retrying…':'Retry loading inventory'}</button>
 </section>;
}

export function EmptyState({title, description, children}: {title: string; description: string; children?: ReactNode}) {
 return <div className="empty feedback-state" role="status"><Package aria-hidden="true"/><h3>{title}</h3><p>{description}</p>{children&&<div className="feedback-actions">{children}</div>}</div>;
}
