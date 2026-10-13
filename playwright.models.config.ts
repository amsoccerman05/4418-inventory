import {defineConfig} from '@playwright/test';

// Pure state transitions: no web server, browser, remote API or stored data.
export default defineConfig({
 testDir:'./tests',
 projects:[
  {name:'purchasing-and-combined-models',testMatch:['**/purchasing-model.spec.ts','**/workflow-model.spec.ts']},
  {name:'packing-model',testMatch:'**/packing/templates.spec.ts',grep:/demo model rejects/},
  {name:'checkout-model',testMatch:'**/tool-checkouts/demo.spec.ts',grep:/model preserves owned/},
 ],
});
