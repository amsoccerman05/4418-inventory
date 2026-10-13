import {repository as local} from '../data';
import {supabase} from './supabase';
import {localWrite} from './local-inventory-write';
import {localPurchasingAction,localPurchasingContext,type PurchasingDatabase} from './purchasing-local';
import {purchasingEmpty,type PurchasingAction,type PurchasingContext,type PurchasingData,type PurchasingRepository} from './purchasing-model';
export class LocalPurchasingRepository implements PurchasingRepository {
 readonly mode='demo' as const;
 async load(itemId?:string){return localPurchasingContext(local.load() as PurchasingDatabase,undefined,itemId);}
 async action(action:PurchasingAction,data:PurchasingData){
  // One JSON save commits receipt + stock + audit together. No separate finance key.
  await localWrite(()=>local.save(localPurchasingAction(local.load() as PurchasingDatabase,action,data)),true);
 }
}
export class SupabasePurchasingRepository implements PurchasingRepository {
 readonly mode='supabase' as const;
 async load(itemId?:string):Promise<PurchasingContext>{
  if(!supabase)throw new Error('Shared workspace is not configured');
  const {data,error}=await supabase.rpc('inventory_purchasing_context',{p_item_id:itemId??null});
  if(error){if(['PGRST202','42883'].includes(error.code))return {...purchasingEmpty(),available:false,can_request:false};throw error;}
  if(!data||!Array.isArray(data.requests)||!Array.isArray(data.settings)||!Array.isArray(data.receipts))throw new Error('Purchasing response could not be read');
  return data as PurchasingContext;
 }
 async action(action:PurchasingAction,data:PurchasingData){
  if(!supabase)throw new Error('Shared workspace is not configured');
  if(action.startsWith('demo_'))throw new Error('Demo approval controls are unavailable in the shared workspace');
  const {error}=await supabase.rpc('inventory_purchasing_action',{p_action:action,p_data:data});if(error)throw error;
 }
}
export const purchasingRepository:PurchasingRepository=supabase?new SupabasePurchasingRepository():new LocalPurchasingRepository();
