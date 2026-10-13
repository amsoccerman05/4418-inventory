import type {Database} from '../data';

/** Local optimistic versions must advance even within one millisecond or after clock rollback. */
export function nextLocalTimestamp(db:Database):string {
 let timestamp=Date.now();
 const rows=[...db.items,...(db.logistics?.balances??[]),...(db.logistics?.toolLoans??[])];
 for(const row of rows){const previous=Date.parse(row.updatedAt||'');if(Number.isFinite(previous))timestamp=Math.max(timestamp,previous+1);}
 return new Date(timestamp).toISOString();
}
