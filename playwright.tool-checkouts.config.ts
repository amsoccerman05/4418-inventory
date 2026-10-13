import {defineConfig} from '@playwright/test';
const shared=process.env.TEST_TOOL_SHARED==='1';
export default defineConfig({testDir:'./tests/tool-checkouts',testMatch:shared?'shared.spec.ts':'demo.spec.ts',workers:1,timeout:45000,use:{baseURL:shared?'http://127.0.0.1:5181':'http://127.0.0.1:5180',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}},webServer:shared?[
 {command:'node tests/mock-supabase.mjs',env:{TEST_LOGISTICS:'1',TEST_TOOL_CHECKOUTS:'1',TEST_SUPABASE_PORT:'54335'},url:'http://127.0.0.1:54335/health',reuseExistingServer:false},
 {command:'npm run dev -- --host 127.0.0.1 --port 5181 --strictPort',url:'http://127.0.0.1:5181',env:{VITE_SUPABASE_URL:'http://127.0.0.1:54335',VITE_SUPABASE_ANON_KEY:'test-public-key',VITE_INVENTORY_MODE:''},reuseExistingServer:false}
]:{command:'npm run dev -- --host 127.0.0.1 --port 5180 --strictPort',url:'http://127.0.0.1:5180',env:{VITE_INVENTORY_MODE:'demo'},reuseExistingServer:false}});
