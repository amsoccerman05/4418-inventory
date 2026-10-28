import type {InventoryAction,ActionData,Media} from './logistics-model';
import type { Database, Item } from '../data';
export const userRoles=['readonly','student','lead','admin','mentor'] as const;
export type UserRole=typeof userRoles[number];
export interface UserProfile { id:string; displayName:string; email:string; role:UserRole; primaryAreaId:string|null; active:boolean; updatedAt?:string }
export interface InventoryEvent { id:string; itemId:string|null; itemName:string; areaId:string|null; userId:string|null; eventType:string; quantityBefore:number|null; quantityAfter:number|null; changeAmount:number|null; notes:string; createdAt:string }
export interface QuantityResult { before:number; item:Item; locationQuantity?:number }
export interface InventoryRepository {
 action(action:InventoryAction|'enable',data:ActionData):Promise<void>;
 photoUrl(path:string):Promise<string>;
 savePhoto(kind:Media['entityType'],id:string,file:File,alt:string,previous?:Media):Promise<void>;
 deletePhoto(photo:Media):Promise<void>;
 readonly mode:'demo'|'supabase';
 load():Promise<Database>;
 apply(before:Database,next:Database):Promise<void>;
 quantity(item:Item,change:{delta?:number;quantity?:number;verify?:boolean}):Promise<QuantityResult>;
 verifyDrawer(db:Database,id:string):Promise<void>;
 subscribe(onChange:()=>void,onStatus:(message:string)=>void):()=>void;
 profiles():Promise<UserProfile[]>;
 locationCreationContext():Promise<{userId:string|null;assignedLead:boolean}>;
 history(itemId?:string,areaId?:string):Promise<InventoryEvent[]>;
 importData(source:Database,current:Database):Promise<void>;
}
export const isAdmin=(p:UserProfile)=>p.active&&['admin','mentor'].includes(p.role);
export const canCount=(p:UserProfile)=>p.active&&p.role!=='readonly';
export const canEdit=(p:UserProfile,areaId:string)=>isAdmin(p)||(p.active&&p.role==='lead'&&p.primaryAreaId===areaId);
export const canCreate=(p:UserProfile,_areaId:string)=>p.active&&['student','lead','admin','mentor'].includes(p.role);
export const demoProfile:UserProfile={id:'local-demo',displayName:'Demo workspace',email:'',role:'mentor',primaryAreaId:null,active:true};
