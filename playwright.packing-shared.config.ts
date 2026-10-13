import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/packing-shared',workers:1,timeout:60000,
 use:{baseURL:'http://127.0.0.1:5195',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}},
 webServer:[
  {command:'node tests/mock-supabase.mjs',url:'http://127.0.0.1:54404/health',env:{TEST_LOGISTICS:'1',TEST_PACKING:'1',TEST_PORT:'54404'},reuseExistingServer:false},
  {command:'npm run dev -- --host 127.0.0.1 --port 5195 --strictPort',url:'http://127.0.0.1:5195',env:{VITE_SUPABASE_URL:'http://127.0.0.1:54404',VITE_SUPABASE_ANON_KEY:'test-public-key',VITE_INVENTORY_MODE:''},reuseExistingServer:false},
 ],
});
