import {repository as local} from '../data';
/** Shared by every local workflow so cross-tab saves cannot erase another operation. */
export const localWrite=async<T,>(work:()=>T|Promise<T>,requireLock=false):Promise<T>=>{
 if(navigator.locks)return navigator.locks.request('inventory-demo-write',work);
 const db=local.load() as ReturnType<typeof local.load>&{purchasing?:unknown};
 if(requireLock||db.purchasing)throw new Error('Safe demo workflow updates require a browser with Web Locks support. Use the shared workspace or a current browser.');
 return work();
};
