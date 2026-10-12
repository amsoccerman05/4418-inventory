import type {RestockPolicy} from './services/setup-model';
import type {Logistics, LocationClass} from './services/logistics-model';
import { createId } from './utils/id';
export interface Area { id: string; name: string; lead: string; slug?: string }
export const locationKinds = ['Storage', 'Side', 'Shelf', 'Bin', 'Drawer'] as const;
export interface Location { labelCode?:string; classification?:LocationClass; areaId?:string; tripId?:string; active?:boolean; id: string; room: string; storage: string; bin: string; name?: string; parentId?: string | null; kind?: typeof locationKinds[number]; description?: string }
export const itemTypes = ['Part', 'Consumable', 'Raw Material', 'Tool', 'Asset'] as const;
export const ownerships = ['Shared / School', 'FRC 4418', 'BEST'] as const;
export interface Item { restockPolicy?:RestockPolicy; totalQuantity?:number; homeLocationId?:string; balanceLocationId?:string; assignedElsewhere?:number; id: string; name: string; areaId: string; category: string; quantity: number; unit: string; minimum: number; target: number; locationId: string; manufacturer: string; partNumber: string; vendor: string; url: string; cost: number; notes: string; updatedAt: string; lastVerified: string; updatedBy: string; orderStatus?: OrderState; trackingMode?: 'quantity' | 'individual'; itemType: typeof itemTypes[number]; ownership: typeof ownerships[number]; expectedQuantity: number | null; slot: string; lastVerifiedBy?:string; legacyUpdatedBy?:string }
export const orderStates = ['Needs Order', 'Ordered', 'Received'] as const;
export type OrderState = typeof orderStates[number];
export const orderStatus = (item: Item): OrderState => item.orderStatus ?? 'Needs Order';
// Future individual instances reference the parent item; quantity remains aggregate in V0.
// This contract adds no asset records, screens, or checkout behavior.
export interface InventoryAsset { id: string; itemId: Item['id']; serialNumber?: string; assetTag?: string; locationId?: Location['id'] }
export function migrateItem(item: Item & { verifiedAt?: string }): Item {
 const { verifiedAt, ...current } = item;
 return { ...current, restockPolicy:current.restockPolicy??'unset', lastVerified: current.lastVerified ?? verifiedAt ?? '', orderStatus: current.orderStatus || 'Needs Order', trackingMode: current.trackingMode || 'quantity', itemType: current.itemType || (current.category === 'Tools' ? 'Tool' : 'Part'), ownership: current.ownership || 'FRC 4418', expectedQuantity: current.expectedQuantity ?? null, slot: current.slot ?? '' };
}
export const filterRestock = (items: Item[], areaId = '', state: OrderState | '' = '') => items.filter(item => item.restockPolicy !== 'do_not_restock' && status(item) !== 'GOOD' && (!areaId || item.areaId === areaId) && (!state || orderStatus(item) === state));
export interface Database { setupAvailable?:boolean; logistics?:Logistics; version: 1; items: Item[]; areas: Area[]; categories: string[]; locations: Location[] }
export const status = (i: Item) => (i.totalQuantity??i.quantity) === 0 ? 'OUT' : (i.totalQuantity??i.quantity) <= i.minimum ? 'LOW' : 'GOOD';
export const needsVerification = (i: Item) => !i.lastVerified || Date.now() - new Date(i.lastVerified).getTime() > 90 * 86400000;
export const blankItem = (): Item => ({restockPolicy:'unset',id: createId(), name:'',areaId:'power',category:'',quantity:0,unit:'each',minimum:0,target:0,locationId:'',manufacturer:'',partNumber:'',vendor:'',url:'',cost:0,notes:'',updatedAt:new Date().toISOString(),lastVerified:'',updatedBy:'',orderStatus:'Needs Order',trackingMode:'quantity',itemType:'Part',ownership:'FRC 4418',expectedQuantity:null,slot:''});
export function demo(): Database {
 const names = ['Fabrication','Power','Software','Operations','CAD','Strategy','Finance','Business','Communications','General / Admin'];
 const areas = names.map(name => ({id:name.toLowerCase().replace(/\W+/g,'-'),name,lead:''}));
 const locations: Location[] = [{id:'e-04',room:'Robotics Lab',storage:'Electrical Cabinet',bin:'E-04'},{id:'e-02',room:'Robotics Lab',storage:'Electrical Cabinet',bin:'E-02'},{id:'m-01',room:'Machine Shop',storage:'Hardware Drawers',bin:'M-01'},{id:'m-03',room:'Machine Shop',storage:'Material Rack',bin:'M-03'},{id:'p-01',room:'Robotics Lab',storage:'Pit Cart',bin:'P-01'},{id:'s-02',room:'Robotics Lab',storage:'Software Cabinet',bin:'S-02'},{id:'c-01',room:'Team Room',storage:'Media Cabinet',bin:'C-01'}];
 const rows: [string,string,string,number,number,number,string,string,string][] = [
 ['Kraken X60','power','Motors & motion',8,4,12,'e-04','each','WestCoast Products'],['NEO Vortex','power','Motors & motion',3,4,8,'e-04','each','REV Robotics'],['CANivore','power','Electronics',0,1,2,'e-02','each','CTRE'],['roboRIO 2.0','power','Electronics',2,1,3,'e-02','each','AndyMark'],['Power Distribution Hub','power','Electronics',2,2,4,'e-02','each','REV Robotics'],['10 AWG wire','power','Wiring & connectors',45,20,100,'e-04','ft','AndyMark'],['Anderson SB50 connectors','power','Wiring & connectors',6,8,20,'e-04','each','AndyMark'],['1/2" hex bearings','fabrication','Hardware',48,20,100,'m-01','each','WestCoast Products'],['1/2" hex shaft','fabrication','Raw materials',12,5,24,'m-03','ft','WestCoast Products'],['#10-32 bolts','fabrication','Hardware',140,50,250,'m-01','each','McMaster-Carr'],['Rivets','fabrication','Hardware',18,25,100,'m-01','each','McMaster-Carr'],['Aluminum tubing','fabrication','Raw materials',24,10,48,'m-03','ft','OnlineMetals'],['Polycarbonate sheet','fabrication','Raw materials',0,2,5,'m-03','sheets','McMaster-Carr'],['Extension cords','operations','Pit supplies',6,3,8,'p-01','each','Home Depot'],['Safety glasses','operations','Safety',9,10,24,'p-01','pairs','Uline'],['Gaffer tape','operations','Pit supplies',4,2,8,'p-01','rolls','Home Depot'],['USB cables','software','Cables & adapters',12,5,20,'s-02','each','Amazon'],['Ethernet cables','software','Cables & adapters',3,4,10,'s-02','each','Monoprice'],['Programming adapters','software','Cables & adapters',4,2,6,'s-02','each','REV Robotics'],['Mirrorless camera','communications','Media equipment',1,0,1,'c-01','each','B&H'],['Tripods','communications','Media equipment',2,1,3,'c-01','each','B&H'],['Team banners','communications','Team materials',3,1,4,'c-01','each','Signs.com'],['Digital calipers','cad','Tools',3,1,4,'m-01','each','McMaster-Carr'],['Scouting clipboards','strategy','Team materials',8,4,12,'p-01','each','Staples'],['Receipt envelopes','finance','Office supplies',20,5,30,'c-01','each','Staples'],['Sponsor brochures','business','Team materials',75,25,150,'c-01','each','Local print shop'],['Dry erase markers','general-admin','Office supplies',8,4,12,'c-01','each','Staples']];
 const items: Item[] = rows.map(([name,areaId,category,quantity,minimum,target,locationId,unit,vendor],n) => ({...blankItem(), id:`demo-${n+1}`,name,areaId,category,quantity,minimum,target,locationId,unit,vendor,lastVerified:n%6===0?'':new Date().toISOString()}));
 for(const item of items){
  if(item.category==='Raw materials')item.itemType='Raw Material';
  else if(['Hardware','Office supplies'].includes(item.category)||item.name==='10 AWG wire'||item.name==='Gaffer tape')item.itemType='Consumable';
  else if(item.category==='Tools'){item.itemType='Tool';item.expectedQuantity=item.quantity;}
  else if(item.category==='Media equipment')item.itemType='Asset';
 }
 const tools=toolDemo();locations.push(...tools.locations);items.push(...tools.items);
 return {version:1,areas,locations,items,categories:[...new Set(items.map(i=>i.category))].sort()};
}
export interface LocalSnapshotRepository { load(): Database; save(db: Database): void; existing(): Database | null }
const KEY='frc-4418-inventory-v1';
export const repository: LocalSnapshotRepository = {
 load() { const raw=localStorage.getItem(KEY); if(!raw) return demo(); const db=JSON.parse(raw); if(db.version!==1 || !Array.isArray(db.items) || !Array.isArray(db.areas) || !Array.isArray(db.locations) || !Array.isArray(db.categories)) throw new Error('Saved data cannot be read. Export or recover your browser data before resetting.'); return {...db, items: db.items.map(migrateItem)}; },
 save(db) { localStorage.setItem(KEY,JSON.stringify(db)); },
 existing() { return localStorage.getItem(KEY) ? this.load() : null; }
};
export const csvFields = ['id','name','areaId','category','quantity','unit','minimum','target','locationId','manufacturer','partNumber','vendor','url','cost','notes','updatedAt','lastVerified','updatedBy','orderStatus','trackingMode','itemType','ownership','expectedQuantity','slot','restockPolicy'] as const;
export function exportCsv(items: Item[]) { return '\uFEFF'+[csvFields.join(','),...items.map(i=>csvFields.map(k=>'"'+String(k === 'orderStatus' ? orderStatus(i) : (i[k] ?? '')).replaceAll('"','""')+'"').join(','))].join('\r\n'); }
export function importCsv(text: string, db: Database): Item[] {
 const rows: string[][]=[]; let row:string[]=[],cell='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let n=0;n<text.length;n++){const c=text[n];if(c==='"'){if(quoted&&text[n+1]==='"'){cell+='"';n++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[n+1]==='\n')n++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw new Error('CSV contains an unclosed quote.');row.push(cell);if(row.some(Boolean))rows.push(row);
 const headers=(rows.shift()??[]).map(h=>h==='verifiedAt'?'lastVerified':h);for(const key of ['name','areaId','category','quantity'])if(!headers.includes(key))throw new Error(`Missing required column: ${key}`);
 if(!rows.length)throw new Error('No items found in CSV.');
 const importedIds=new Set<string>();
 return rows.map((r,n)=>{const values=Object.fromEntries(headers.map((h,j)=>[h,r[j]??'']));const suppliedId=values.id?.trim();
 const existing=suppliedId?db.items.find(i=>i.id===suppliedId):undefined;
 const item={...(existing??blankItem()),...Object.fromEntries(csvFields.filter(k=>k!=='id'&&values[k]!==undefined).map(k=>[k,values[k]]))} as Item;
 if(suppliedId)item.id=suppliedId;
 if(importedIds.has(item.id))throw new Error(`Row ${n+2}: duplicate item ID ${item.id}`);importedIds.add(item.id);for(const k of ['quantity','minimum','target','cost'] as const){item[k]=values[k]===undefined?item[k]:Number(values[k]||0);if(!Number.isFinite(item[k])||item[k]<0)throw new Error(`Row ${n+2}: invalid ${k}`);}if(!item.name.trim()||!item.category.trim()||!values.quantity?.trim())throw new Error(`Row ${n+2}: name, category and quantity are required.`);if(!db.areas.some(a=>a.id===item.areaId))throw new Error(`Row ${n+2}: unknown areaId ${item.areaId}`);if(item.locationId&&!db.locations.some(l=>l.id===item.locationId))throw new Error(`Row ${n+2}: unknown locationId`);if(item.orderStatus&&!orderStates.includes(item.orderStatus))throw new Error(`Row ${n+2}: unknown orderStatus`);if(item.trackingMode&&!['quantity','individual'].includes(item.trackingMode))throw new Error(`Row ${n+2}: unknown trackingMode`);if(values.expectedQuantity?.trim()){item.expectedQuantity=Number(values.expectedQuantity);if(!Number.isFinite(item.expectedQuantity)||item.expectedQuantity<0)throw new Error(`Row ${n+2}: invalid expectedQuantity`);}else if(values.expectedQuantity!==undefined)item.expectedQuantity=null;
 if(item.restockPolicy&&!['unset','restock','do_not_restock'].includes(item.restockPolicy))throw new Error(`Row ${n+2}: unknown restockPolicy`);
 if(item.restockPolicy==='restock'&&item.target<=item.minimum)throw new Error(`Row ${n+2}: target must exceed minimum for restock`);
 if(item.itemType&&!itemTypes.includes(item.itemType))throw new Error(`Row ${n+2}: unknown itemType`);
 if(item.ownership&&!ownerships.includes(item.ownership))throw new Error(`Row ${n+2}: unknown ownership`);
 return migrateItem(item);});
}

// Physical hierarchy uses stable parent IDs; legacy room/storage/bin records still resolve.
export const locationLabel = (location: Location) => location.name || location.bin || location.storage;
export function locationTrail(locations: Location[], id: string): Location[] {
 const trail: Location[]=[];const seen=new Set<string>();let node=locations.find(l=>l.id===id);
 while(node&&!seen.has(node.id)){seen.add(node.id);trail.unshift(node);node=locations.find(l=>l.id===node!.parentId);}
 return trail;
}
export function locationPath(locations: Location[], id: string): string {
 const trail=locationTrail(locations,id);if(!trail.length)return 'Unassigned';
 if(trail.length===1&&!trail[0].name)return `${trail[0].room} → ${trail[0].storage} → ${trail[0].bin}`;
 return trail.map(locationLabel).join(' → ');
}
export const inLocation = (locations: Location[], itemLocationId: string, parentId: string) => locationTrail(locations,itemLocationId).some(l=>l.id===parentId);
export const missingTools = (item: Item) => item.itemType==='Tool'&&item.expectedQuantity!==null&&item.quantity+(item.assignedElsewhere??0)<item.expectedQuantity;
export const toolCompleteness = (item: Item) => item.expectedQuantity===null ? 'Not configured' : missingTools(item) ? 'Missing tools' : 'Complete';
export function verifyDrawer(db: Database, locationId: string, timestamp=new Date().toISOString()): Database {
 if(!db.locations.some(l=>l.id===locationId&&l.kind==='Drawer'))throw new Error('Only drawer locations can be audited.');
 return {...db,items:db.items.map(i=>i.locationId===locationId?{...i,lastVerified:timestamp,updatedAt:timestamp}:i)};
}

export function toolDemo(): { locations: Location[]; items: Item[] } {
 const locations: Location[]=[];
 const addLocation=(id:string,name:string,kind:Location['kind'],parentId:string|null,description='')=>locations.push({id,name,kind,parentId,description,room:'Robotics Lab',storage:parentId??name,bin:id.toUpperCase()});
 addLocation('toolbox-a','Toolbox A — Mechanical / General','Storage',null);
 addLocation('toolbox-b','Toolbox B — Electrical / Specialty','Storage',null);
 const mechanical=['SAE Hex Keys','Metric Hex Keys','Screwdrivers','Torx Drivers','Combination Wrenches','Ratchets & Sockets','Pliers','Riveting & Nutserts','Measurement','Finishing Tools','Drills & Drivers','Drill Bits','Specialty Bits','Robot Assembly','Spare Hand Tools'];
 const electrical=['Cutters & Pliers','Wire Stripping','Crimping','Meters & Test Leads','Network Tools','Soldering','Heat Tools','Battery Tools','Precision Drivers','CAN & Control Tools','Connector Tools','Cable Management','Power Tool Accessories','Robot Service','Electrical Spares'];
 for(let n=1;n<=15;n++){
  const suffix=String(n).padStart(2,'0');
  addLocation(`ta-${suffix}`,`TA-${suffix}`,'Drawer','toolbox-a',mechanical[n-1]);
  addLocation(`tb-${suffix}`,`TB-${suffix}`,'Drawer','toolbox-b',electrical[n-1]);
 }
 addLocation('storage-closet','Storage Closet','Storage',null);
 for(const [side,letter] of [['Left Side','l'],['Right Side','r']]){
  addLocation(`closet-${letter}`,side,'Side','storage-closet');
  for(let n=1;n<=2;n++){
   addLocation(`closet-${letter}-shelf-${n}`,`Shelf ${n}`,'Shelf',`closet-${letter}`);
   addLocation(`cl-${letter}-0${n}`,`CL-${letter.toUpperCase()}-0${n}`,'Bin',`closet-${letter}-shelf-${n}`);
  }
 }
 // name, drawer, current, expected, minimum, target, labeled position.
 const rows: [string,string,number,number,number,number,string][]=[
 ['5/64" Allen wrench','ta-01',2,2,1,3,'5/64'],['3/32" Allen wrench','ta-01',2,2,1,3,'3/32'],['1/8" Allen wrench','ta-01',3,4,2,6,'1/8'],['5/32" Allen wrench','ta-01',3,4,2,6,'5/32'],['3/16" Allen wrench','ta-01',2,3,1,5,'3/16'],['1/4" Allen wrench','ta-01',2,2,1,3,'1/4'],
 ['2 mm Allen wrench','ta-02',2,2,1,3,'2 mm'],['2.5 mm Allen wrench','ta-02',2,2,1,3,'2.5 mm'],['3 mm Allen wrench','ta-02',1,3,1,4,'3 mm'],['4 mm Allen wrench','ta-02',3,3,1,4,'4 mm'],['5 mm Allen wrench','ta-02',2,2,1,3,'5 mm'],['6 mm Allen wrench','ta-02',2,2,1,3,'6 mm'],
 ['#1 Phillips screwdriver','ta-03',2,2,1,3,'PH1'],['#2 Phillips screwdriver','ta-03',3,4,2,6,'PH2'],['1/4" flathead screwdriver','ta-03',2,2,1,3,'1/4'],['3/16" flathead screwdriver','ta-03',2,2,1,3,'3/16'],
 ['T10 Torx driver','ta-04',2,2,1,3,'T10'],['T20 Torx driver','ta-04',1,2,0,3,'T20'],['T25 Torx driver','ta-04',2,2,1,3,'T25'],
 ['3/8" combination wrench','ta-05',3,3,1,4,'3/8'],['7/16" combination wrench','ta-05',3,4,2,6,'7/16'],['1/2" combination wrench','ta-05',4,4,2,6,'1/2'],['9/16" combination wrench','ta-05',2,2,1,3,'9/16'],['10 mm combination wrench','ta-05',2,3,1,4,'10 mm'],
 ['3/8" drive ratchet','ta-06',2,2,1,3,'R1'],['1/4" drive ratchet','ta-06',2,2,1,3,'R2'],['1/2" socket — 3/8" drive','ta-06',3,3,1,4,'1/2'],['7/16" socket — 3/8" drive','ta-06',2,2,1,3,'7/16'],['10 mm socket — 1/4" drive','ta-06',0,2,1,3,'10 mm'],
 ['Needle-nose pliers — 6"','ta-07',3,3,1,4,'P1'],['Channel-lock pliers — 10"','ta-07',2,2,1,3,'P2'],['Locking pliers — 7"','ta-07',2,2,1,3,'P3'],
 ['Hand rivet tool','ta-08',2,2,1,3,'R1'],['10-32 nutsert tool','ta-08',1,1,0,2,'N1'],
 ['6" digital calipers','ta-09',3,3,1,4,'C1'],['16 ft tape measure','ta-09',2,3,1,4,'T1'],['6" combination square','ta-09',2,2,1,3,'S1'],
 ['Swivel deburring tool','ta-10',3,3,1,4,'D1'],['8" flat file','ta-10',2,2,1,3,'F1'],['6" round file','ta-10',2,2,1,3,'F2'],['Automatic center punch','ta-10',2,2,1,3,'C1'],
 ['18V cordless drill','ta-11',2,2,1,3,'D1'],['18V impact driver','ta-11',2,2,1,3,'I1'],
 ['1/8" drill bit','ta-12',4,6,3,12,'1/8'],['#7 drill bit','ta-12',3,3,1,6,'#7'],['#21 drill bit','ta-12',3,3,1,6,'#21'],['1/4" drill bit','ta-12',4,4,2,8,'1/4'],
 ['1/8–1/2" step bit','ta-13',2,2,1,3,'S1'],['82° countersink bit','ta-13',2,2,1,3,'C1'],
 ['1/2" hex shaft bearing puller','ta-14',1,1,0,2,'B1'],['#25 chain breaker','ta-14',1,1,0,2,'C1'],['10-32 hand tap','ta-14',2,2,1,4,'T1'],['1/4-20 hand tap','ta-14',2,2,1,4,'T2'],
 ['3/8" drive torque wrench','ta-15',1,1,0,2,'T1'],
 ['Side cutters — 6"','tb-01',3,3,1,4,'C1'],['Flush cutters — 5"','tb-01',1,3,1,5,'C2'],['Needle-nose pliers — insulated','tb-01',2,2,1,3,'P1'],
 ['10–22 AWG wire strippers','tb-02',3,3,1,4,'W1'],['Automatic wire stripper','tb-02',1,2,0,3,'W2'],
 ['Ratcheting terminal crimper','tb-03',2,2,1,3,'C1'],['Ferrule crimper','tb-03',2,2,1,3,'C2'],['Anderson Powerpole crimper','tb-03',1,1,0,2,'C3'],
 ['Digital multimeter','tb-04',2,3,1,4,'M1'],['Clamp meter','tb-04',1,1,0,2,'M2'],
 ['RJ45 Ethernet crimper','tb-05',1,1,0,2,'N1'],['Ethernet cable tester','tb-05',1,1,0,2,'N2'],['Network punch-down tool','tb-05',1,1,0,2,'N3'],
 ['Temperature-controlled soldering iron','tb-06',2,2,1,3,'S1'],['Desoldering pump','tb-06',2,2,1,3,'S2'],['PCB helping hands','tb-06',2,2,1,3,'S3'],
 ['Variable-temperature heat gun','tb-07',2,2,1,3,'H1'],
 ['Battery lug crimper — 6–10 AWG','tb-08',1,1,0,2,'B1'],['SB50 contact extraction tool','tb-08',0,1,0,2,'B2'],
 ['#0 precision Phillips screwdriver','tb-09',2,2,1,3,'PH0'],['2 mm precision flathead driver','tb-09',2,2,1,3,'2 mm'],
 ['CAN termination test adapter','tb-10',1,1,0,2,'CAN1'],['PWM servo tester','tb-10',1,1,0,2,'PWM1'],
 ['JST connector crimper','tb-11',1,1,0,2,'J1'],['Deutsch pin extraction tool','tb-11',2,2,1,3,'D1'],
 ['Cable tie tensioning tool','tb-12',1,1,0,2,'T1'],
 ['1/4" magnetic bit holder','tb-13',2,2,1,3,'B1'],
 ['REV MAXSpline wrench','tb-14',1,1,0,2,'REV1'],['Pneumatic tubing cutter','tb-14',2,2,1,3,'P1'],
 ['ESD-safe precision tweezers','tb-15',2,2,1,3,'T1']
 ];
 const items=rows.map(([name,locationId,quantity,expectedQuantity,minimum,target,slot],n):Item=>({...blankItem(),id:`tool-demo-${n+1}`,name,areaId:locationId.startsWith('ta')?'fabrication':'power',category:locationId.startsWith('ta')?'Mechanical tools':'Electrical tools',quantity,expectedQuantity,minimum,target,slot,locationId,itemType:'Tool',ownership:'Shared / School',lastVerified:n%4===0?'':new Date().toISOString()}));
 items.push({...blankItem(),id:'closet-demo-1',name:'Safety glasses — spare stock',areaId:'operations',category:'Safety',quantity:12,minimum:4,target:20,locationId:'cl-l-01',itemType:'Consumable',ownership:'Shared / School'},
 {...blankItem(),id:'closet-demo-2',name:'BEST practice field measuring tape',areaId:'operations',category:'Tools',quantity:1,expectedQuantity:1,minimum:0,target:1,locationId:'cl-r-01',itemType:'Tool',ownership:'BEST'});
 return {locations,items};
}
export function addToolDemo(db: Database): Database {
 const sample=toolDemo();const locations=[...db.locations,...sample.locations.filter(l=>!db.locations.some(existing=>existing.id===l.id))];
 const items=[...db.items,...sample.items.filter(i=>!db.items.some(existing=>existing.id===i.id))];
 return {...db,locations,items,categories:[...new Set([...db.categories,...items.map(i=>i.category)])]};
}


/** Import replaces matching records by ID; location/area definitions stay untouched. */
export function mergeImportedItems(db: Database, items: Item[]): Database {
 const incoming=new Map(items.map(i=>[i.id,i]));
 const existing=new Set(db.items.map(i=>i.id));
 return {...db,items:[...db.items.map(i=>incoming.has(i.id)?{...i,...incoming.get(i.id)!}:i),...items.filter(i=>!existing.has(i.id))],categories:[...new Set([...db.categories,...items.map(i=>i.category)])]};
}
const normalizedItemName=(name:string)=>name.normalize('NFKC').toLowerCase().replace(/["“”″′]/g,'').replace(/\s+/g,' ').trim();
/** Same size/name in the same location and ownership is a possible duplicate, not a forced merge. */
export function possibleDuplicates(items: Item[], item: Item): Item[] {
 const name=normalizedItemName(item.name);
 return name?items.filter(other=>other.id!==item.id&&normalizedItemName(other.name)===name&&other.locationId===item.locationId&&other.ownership===item.ownership&&other.itemType===item.itemType):[];
}
