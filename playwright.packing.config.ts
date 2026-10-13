import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/packing',workers:1,timeout:60000,
 use:{baseURL:'http://127.0.0.1:5194',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5194 --strictPort',url:'http://127.0.0.1:5194',env:{VITE_INVENTORY_MODE:'demo'},reuseExistingServer:false},
});
