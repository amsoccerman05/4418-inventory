import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual repository class with a synthetic client, not a live backend.
const source=(await readFile(new URL('../src/services/repository.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/\bexport /g,'');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
function repository(client,timers={setTimeout,clearTimeout}){
 const Constructor=new Function('supabase','profileFromRow','setTimeout','clearTimeout',compiled+'\nreturn SupabaseInventoryRepository;')(client,r=>r,timers.setTimeout,timers.clearTimeout);
 return new Constructor();
}
test('optional capability cannot hold profile revocation refresh hostage',async()=>{
 let capabilityCalls=0;
 const chain={select:()=>chain,order:()=>chain,range:async()=>({data:[{id:'synthetic-account',active:false,role:'student'}],error:null})};
 const repo=repository({from:()=>chain,rpc:()=>{capabilityCalls++;return {abortSignal:()=>new Promise(()=>{})};}});
 const profiles=await repo.profiles();assert.equal(profiles[0].active,false);assert.equal(capabilityCalls,0);
});
test('capability is a self-bound GET and fails closed on malformed responses or missing migration',async()=>{
 for(const response of [{data:{user_id:'synthetic-account',assigned_lead:true},error:null},{data:{user_id:'synthetic-account',assigned_lead:'true'},error:null},{data:{assigned_lead:true},error:null},{data:null,error:{code:'PGRST202'}}]){
  let args;const repo=repository({rpc:(...input)=>{args=input;return {abortSignal:async()=>response};}});
  const context=await repo.locationCreationContext();assert.deepEqual(args,['inventory_location_creation_context',undefined,{get:true}]);
  assert.equal(context.assignedLead,response.error===null&&response.data?.user_id==='synthetic-account'&&response.data?.assigned_lead===true);
 }
});
test('a hanging capability request is aborted at five seconds without enabling creation',async()=>{
 let fire,cleared=false,aborted=false;
 const timers={setTimeout:(fn,ms)=>{assert.equal(ms,5000);fire=fn;return 123;},clearTimeout:id=>{assert.equal(id,123);cleared=true;}};
 const repo=repository({rpc:()=>({abortSignal:signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('synthetic timeout'));},{once:true}))})},timers);
 const result=repo.locationCreationContext();fire();assert.deepEqual(await result,{userId:null,assignedLead:false,canRename:false});assert.equal(aborted,true);assert.equal(cleared,true);
});
