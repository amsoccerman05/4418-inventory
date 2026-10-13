import {localWrite} from './local-inventory-write';
import {repository as local} from '../data';
import {supabase} from './supabase';
import {inventoryRepository} from './repository';
import {demoProfile} from './types';
import {packingLocalAction} from './packing-local';
import type {PackingTemplate,PackingCommand,PackingReceipt} from './packing-model';

export const packingRepository={
 async list():Promise<PackingTemplate[]>{
  if(inventoryRepository.mode==='demo')return local.load().logistics?.packing?.templates??[];
  if(!supabase)throw new Error('Supabase is not configured');
  const templates:PackingTemplate[]=[];
  for(let page=0;;page++){
   const {data,error}=await supabase.from('packing_templates').select('*').order('created_at',{ascending:false}).order('id').range(page*1000,page*1000+999);if(error)throw error;
   templates.push(...data.map(r=>({id:r.id,name:r.name,lines:r.lines,sourceTripId:r.source_trip_id,createdAt:r.created_at,createdBy:r.created_by})));
   if(data.length<1000)return templates;
  }
 },
 async action(action:'save'|'approve',command:PackingCommand):Promise<PackingReceipt>{
  if(inventoryRepository.mode==='demo')return localWrite(()=>{const result=packingLocalAction(local.load(),demoProfile,action,command);local.save(result.db);return result.result;},true);
  if(!supabase)throw new Error('Supabase is not configured');
  const {data,error}=await supabase.rpc('packing_template_action',{p_action:action,p_data:command});if(error)throw error;return data;
 }
};
