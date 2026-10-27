import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/shared',outputDir:'./test-results/shared',workers:1,timeout:60000,
 use:{screenshot:'only-on-failure',trace:'retain-on-failure',baseURL:'http://127.0.0.1:5176',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{},},
 webServer:[
  {command:'node tests/mock-supabase.mjs',url:'http://127.0.0.1:54329/health',reuseExistingServer:false},
  {command:'npm run dev -- --host 127.0.0.1 --port 5176 --strictPort',url:'http://127.0.0.1:5176',env:{VITE_SUPABASE_URL:'http://127.0.0.1:54329',VITE_SUPABASE_ANON_KEY:'test-public-key',VITE_INVENTORY_MODE:''},reuseExistingServer:false},
 ],
});
