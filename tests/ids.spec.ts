import { test, expect } from './browser-fixtures';
import { createId } from '../src/utils/id';

test('application IDs prefer native UUID and fall back to valid unique UUIDs',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 try {
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{randomUUID:()=> 'native-id'}});
  expect(createId()).toBe('native-id');
  for(const crypto of [{getRandomValues:(bytes:Uint8Array)=>{bytes.fill(255);return bytes;}},undefined]){
   Object.defineProperty(globalThis,'crypto',{configurable:true,value:crypto});
   expect(createId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  expect(new Set(Array.from({length:1000},()=>createId())).size).toBe(1000);
 } finally {
  if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);
  else Reflect.deleteProperty(globalThis,'crypto');
 }
});

test('demo initializes and saves quantity changes without randomUUID',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true}));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/#location/ta-01');
 await expect(page.getByRole('heading',{name:'TA-01 — SAE Hex Keys',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add one 5/32" Allen wrench',exact:true}).click();
 await expect(page.locator('.quantity-toast')).toContainText('4 each');
 expect(errors).toEqual([]);
});
