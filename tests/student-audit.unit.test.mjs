import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const main=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
const logistics=await readFile(new URL('../src/logistics.tsx',import.meta.url),'utf8');
function definition(source,name,variable=false){
 const tree=ts.createSourceFile('component.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
 const visit=node=>{if((variable?ts.isVariableDeclaration(node):ts.isFunctionDeclaration(node))&&node.name?.getText(tree)===name)found=variable?node.initializer.getText(tree):node.getText(tree);ts.forEachChild(node,visit);};visit(tree);assert.ok(found,name);return found;
}
function compile(source,scope){
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
 return new Function(...Object.keys(scope),code)(...Object.values(scope));
}
const profile=(role='lead',primaryAreaId=null,active=true)=>({id:'synthetic-user',role,primaryAreaId,active});
const areas=[{id:'active',name:'Power'},{id:'inactive',name:'Software',active:false},{id:'storage',name:'Storage Closet'}];
const admin=p=>p.active&&['admin','mentor'].includes(p.role);
function locationView(p,assigned=false,enabled=true){
 const source=definition(logistics,'ProjectLocationForm').replace('export ','');
 const Component=compile(source+'\nreturn ProjectLocationForm;',{React,useState:React.useState,useRef:React.useRef,useEffect:React.useEffect,useAssignedLocationAccess:()=>assigned,isAdmin:admin,isLead:p=>p.active&&['lead','admin_lead'].includes(p.role),isStorageArea:a=>a.id==='storage',Plus:()=>null});
 return renderToStaticMarkup(React.createElement(Component,{profile:p,db:{areas,logistics:enabled?{}:null},run:()=>{throw Error('Rendering cannot write');}}));
}
test('unassigned account Lead sees an explanation instead of an impossible location action',()=>{
 for(const role of ['lead','admin_lead'])for(const area of [null,'inactive','storage','missing']){const html=locationView(profile(role,area));assert.doesNotMatch(html,/<button/);assert.match(html,/ask a mentor to assign you an active team area/);}
});
test('legacy active-area, assigned-position and admin creation paths remain available',()=>{
 assert.match(locationView(profile('lead','active')),/Add location/);
 for(const role of ['lead','admin_lead','student'])assert.match(locationView(profile(role),true),/Add location/);
 for(const role of ['admin','mentor'])assert.match(locationView(profile(role)),/Add location/);
});
test('location hint does not invent access for students, readonly, inactive or legacy workspaces',()=>{
 for(const role of ['student','readonly'])assert.equal(locationView(profile(role)), '');
 for(const role of ['lead','admin_lead','student','admin','mentor'])assert.equal(locationView(profile(role,null,false),true),'');
 assert.equal(locationView(profile('lead'),false,false),'');
});
function writeHarness({fail=false,refreshFails=false}={}){
 const events=[],pending={current:false},loadSequence={current:0};let error='',version=0,busy=false,refreshCalls=0;
 const fn=compile('return ('+definition(main,'write',true)+');',{
  pending,accessBlocked:false,loadSequence,setBusy:value=>{busy=value;events.push(['busy',value]);},setError:value=>{error=value;events.push(['error',value]);},setWriteErrorVersion:update=>{version=update(version);},friendlyError:e=>e.message,
  refresh:async()=>{refreshCalls++;if(refreshFails)throw Error('Synthetic read failure');},
 });
 return {fn,events,state:()=>({error,version,busy,pending:pending.current,refreshCalls}),action:async()=>{if(fail)throw Error('Synthetic confirmed rejection');}};
}
test('failed writes release the submit lock and announce repeated identical failures',async()=>{
 const h=writeHarness({fail:true});assert.equal(await h.fn(h.action),false);
 assert.deepEqual(h.state(),{error:'Synthetic confirmed rejection Your change was not saved.',version:1,busy:false,pending:false,refreshCalls:1});
 assert.equal(await h.fn(h.action),false);assert.equal(h.state().version,2);
 assert.equal(await h.fn(async()=>{}),true);assert.equal(h.state().error,'');assert.equal(h.state().busy,false);
});
test('repeated submit cannot duplicate an in-flight write',async()=>{
 const h=writeHarness();let release,calls=0;
 const action=()=>{calls++;return new Promise(resolve=>release=resolve);};const first=h.fn(action);
 assert.equal(await h.fn(action),false);assert.equal(calls,1);release();assert.equal(await first,true);
});
test('successful save with a failed refresh retains explicit do-not-submit-again guidance',async()=>{
 const h=writeHarness({refreshFails:true});assert.equal(await h.fn(h.action),true);assert.match(h.state().error,/was saved.*do not submit the change again/);assert.equal(h.state().version,0);
});
test('the active item dialog contains the error without replacing its draft or submit action',()=>{
 const source=definition(main,'ItemEditor');
 const hookReact={...React,useRef:()=>({current:null}),useEffect:()=>{}};
 const Component=compile(source+'\nreturn ItemEditor;',{React:hookReact,useState:React.useState,possibleDuplicates:()=>[],useUnsavedChanges:()=>({request:()=>{},confirmation:null,confirming:false}),canCreate:()=>true,canEdit:()=>true,canCount:()=>true,isAdmin:()=>true,isStorageArea:()=>false,teamAreaLabel:a=>a.name,sharedIdentity:()=>true,locationPath:()=>'',itemTypes:['Part'],ownerships:['FRC 4418'],X:()=>null,ArrowLeft:()=>null});
 const item={id:'draft',name:'Unsaved student title',areaId:'active',category:'Parts',quantity:7,unit:'each',itemType:'Part',ownership:'FRC 4418',locationId:'',minimum:0,target:0,expectedQuantity:null,cost:0,notes:'Keep this note'};
 const html=renderToStaticMarkup(React.createElement(Component,{item,db:{items:[],areas,categories:['Parts'],locations:[]},isNew:true,profile:profile(),saveError:'Synthetic save failure. Review your entry and retry.',saveErrorVersion:2,busy:false,guard:{current:null}}));
 assert.match(html,/role="dialog"[\s\S]*role="alert"[\s\S]*Synthetic save failure/);
 assert.match(html,/value="Unsaved student title"/);assert.match(html,/Keep this note/);assert.match(html,/value="7"/);assert.match(html,/type="submit">Add item/);
});

test('quantity-only success dismisses through the saved callback, not explicit-close error cleanup',async()=>{
 const hookReact={...React,useRef:()=>({current:null}),useEffect:()=>{}};
 const Component=compile(definition(main,'ItemEditor')+'\nreturn ItemEditor;',{React:hookReact,useState:value=>[value,()=>{}],possibleDuplicates:()=>[],useUnsavedChanges:()=>({request:()=>{},confirmation:null,confirming:false}),canCreate:()=>false,canEdit:()=>false,canCount:()=>true,isAdmin:()=>false,isStorageArea:()=>false,teamAreaLabel:a=>a.name,sharedIdentity:()=>true,locationPath:()=>'',itemTypes:['Part'],ownerships:['FRC 4418'],X:()=>null,ArrowLeft:()=>null,Check:()=>null,PhotoPanel:()=>null,ItemLocations:()=>null,Activity:()=>null,inventoryRepository:{}});
 const item={id:'draft',name:'Synthetic count',areaId:'active',category:'Parts',quantity:7,unit:'each',itemType:'Part',ownership:'FRC 4418',locationId:'',minimum:0,target:0,expectedQuantity:null,cost:0,notes:'',updatedAt:'2026-10-28T00:00:00Z'};
 const h=writeHarness({refreshFails:true});let saved=0,closed=0;
 const tree=Component({item,db:{items:[],areas,categories:['Parts'],locations:[]},isNew:false,profile:profile('student'),saveError:'',saveErrorVersion:0,busy:false,guard:{current:null},nameFor:()=>'',onQuantity:()=>h.fn(async()=>{}),onSaved:()=>saved++,onClose:()=>closed++});
 const find=node=>{if(!node||typeof node!=='object')return; if(node.type==='form')return node;for(const child of [node.props?.children].flat(Infinity)){const result=find(child);if(result)return result;}};
 await find(tree).props.onSubmit({preventDefault(){}});
 assert.equal(saved,1);assert.equal(closed,0);assert.match(h.state().error,/was saved.*do not submit the change again/);
});
