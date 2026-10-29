import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../src/services/types.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};new Function('exports',compiled)(exports);
const {canCreate,canEdit,canCount,isAdmin}=exports;
const profile=(role,primaryAreaId=null,active=true)=>({id:'synthetic-account',displayName:'Synthetic account',email:'synthetic@example.test',role,primaryAreaId,active});

test('active Lead inherits Student item creation, including no assigned area',()=>{
 for(const role of ['student','lead','admin_lead','admin','mentor'])for(const assigned of [null,'area-a','area-b'])for(const destination of ['area-a','area-b']){
  assert.equal(canCreate(profile(role,assigned),destination),true,`${role} assigned ${assigned} -> ${destination}`);
 }
});
test('readonly and inactive identities remain unable to create items',()=>{
 for(const role of ['readonly','student','lead','admin_lead','admin','mentor'])for(const assigned of [null,'area-a']){
  assert.equal(canCreate(profile(role,assigned,false),'area-a'),false);
 }
 assert.equal(canCreate(profile('readonly'),'area-a'),false);
});
test('creation does not broaden metadata editing, counting or admin capabilities',()=>{
 for(const role of ['readonly','student','lead','admin_lead','admin','mentor'])for(const active of [true,false])for(const assigned of [null,'area-a','area-b'])for(const destination of ['area-a','area-b']){
  const p=profile(role,assigned,active),admin=active&&['admin','mentor'].includes(role);
  assert.equal(canEdit(p,destination),admin||(active&&['lead','admin_lead'].includes(role)&&assigned===destination));
  assert.equal(isAdmin(p),admin);
  assert.equal(canCount(p),active&&role!=='readonly');
 }
});

test('unknown roles fail closed and Admin Lead is not global admin',()=>{assert.equal(canCount(profile('unknown')),false);assert.equal(canCreate(profile('unknown'),'area-a'),false);assert.equal(isAdmin(profile('admin_lead')),false);});
