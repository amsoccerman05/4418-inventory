import {readFileSync} from 'node:fs';
import {test,expect} from './browser-fixtures';

// Keep the excluded hardware features out of the shipped modules and dependency graph.
test('quality-of-life release contains no scanner or printing implementation',()=>{
 const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const modules=['src/AuthSurface.tsx','src/setup.tsx','src/setup.css','src/main.tsx','src/services/setup-model.ts','src/services/repository.ts','src/services/mapping.ts','src/data.ts'].map(read).join('\n');
 expect(modules).not.toMatch(/LocationScanner|LocationLabels|resolveLocationScan|locationScanUrl|inventorySignInGateway|inventory_location|window\.print|@media\s+print|labelCode|label_code|location-barcode|location-qr/);
 const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));
 for(const name of ['jsbarcode','qrcode.react','@types/jsbarcode','@zxing/library','@zxing/text-encoding','pngjs','@types/pngjs']){
  expect(pkg.dependencies?.[name]).toBeUndefined();expect(pkg.devDependencies?.[name]).toBeUndefined();
  expect(lock.packages['node_modules/'+name]).toBeUndefined();
 }
});
