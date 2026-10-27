import {defineConfig} from '@playwright/test';
import shared from './playwright.shared.config';
export default defineConfig({...shared,testDir:'./tests/logistics-shared',outputDir:'./test-results/logistics',webServer:(shared.webServer as object[]).map((server,index)=>index===0?{...server,env:{TEST_LOGISTICS:'1'}}:server)});
