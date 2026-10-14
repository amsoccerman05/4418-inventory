import {test,expect,type Page} from '@playwright/test';

const privacyUrl='https://team.frc4418.org/privacy.html';
async function expectPrivacyLink(page:Page){
 const link=page.getByRole('link',{name:'Privacy notice (opens in a new tab)'});
 await expect(link).toBeVisible();
 await expect(link).toHaveAttribute('href',privacyUrl);
 await expect(link).toHaveAttribute('target','_blank');
 await expect(link).toHaveAttribute('rel','noopener noreferrer');
 expect(await link.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 return link;
}
for(const width of [390,1440]){
 test(`privacy link on password sign-in surface ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const response=await page.request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{data:{email:'readonly@example.test',password:'test-password'}});
  const session=await response.json();
  const fragment=new URLSearchParams({access_token:session.access_token,refresh_token:session.refresh_token,expires_in:'3600',token_type:'bearer',type:'invite'});
  await page.goto('/#'+fragment.toString());
  await expect(page.getByRole('heading',{name:'Set your password',exact:true})).toBeVisible();
  await expectPrivacyLink(page);
  await expect(page.locator('.suite-header,.sidebar')).toHaveCount(0);
 });
 test(`privacy link preserves signed-in workspace ${width}`,async({page,context})=>{
  await page.setViewportSize({width,height:900});
  const response=await page.request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{data:{email:'readonly@example.test',password:'test-password'}});
  const session=await response.json();
  await page.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),session);
  await context.route(privacyUrl,route=>route.fulfill({contentType:'text/html',body:'<h1>Team 4418 Privacy Notice</h1>'}));
  await page.goto('/#inventory');
  await expect(page.getByRole('heading',{name:'Inventory',exact:true})).toBeVisible();
  const link=await expectPrivacyLink(page);
  await link.focus();
  const popupPromise=page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup=await popupPromise;
  await expect(popup).toHaveURL(privacyUrl);
  await expect(popup.getByRole('heading')).toHaveText('Team 4418 Privacy Notice');
  await popup.close();
  await expect(page).toHaveURL(/#inventory$/);
  await expect(page.getByRole('heading',{name:'Inventory',exact:true})).toBeVisible();
  await page.goto('/#dashboard');await page.goBack();
  await expectPrivacyLink(page);
 });
}
