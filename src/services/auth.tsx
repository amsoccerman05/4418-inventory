import {navigationContext} from '../navigation-context';
import {AuthSurface} from '../AuthSurface';
import {SuiteHeader} from '../SuiteHeader';
import { useEffect,useState,type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase,demoMode,configurationError,authRedirectUrl,friendlyError,passwordFlow } from './supabase';
import { profileFromRow } from './mapping';
import { demoProfile,type UserProfile } from './types';
const logo=`${import.meta.env.BASE_URL}branding/4418-impulse-emblem.png`;
export function AuthGate({children}:{children:(profile:UserProfile,signOut:()=>Promise<void>,updateProfile:(profile:UserProfile)=>void)=>ReactNode}){
 const [session,setSession]=useState<Session|null>(null),[profile,setProfile]=useState<UserProfile|null>(null),[loading,setLoading]=useState(Boolean(supabase)),[error,setError]=useState(configurationError),[recovery,setRecovery]=useState(passwordFlow);
 useEffect(()=>{
  if(!supabase)return;let active=true;
  const {data}=supabase.auth.onAuthStateChange((event,next)=>{if(!active)return;navigationContext.activate(next?.user.id??null);setSession(next);if(!next){setProfile(null);setLoading(false);}if(event==='PASSWORD_RECOVERY')setRecovery(true);});
  void supabase.auth.getSession().then(({data,error})=>{if(!active)return;if(error){setError(friendlyError(error));setLoading(false);}else{navigationContext.activate(data.session?.user.id??null);setSession(data.session);if(!data.session)setLoading(false);}});
  return()=>{active=false;data.subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  if(!session||!supabase)return;let active=true;setLoading(true);
  void supabase.from('profiles').select('*').eq('id',session.user.id).single().then(({data,error})=>{if(!active)return;if(error){setError('Could not load your team profile. Ask a mentor to check your account, then retry.');setProfile(null);}else{setProfile(profileFromRow(data));setError('');}setLoading(false);});
  return()=>{active=false;};
 },[session?.user.id]);
 const signOut=async()=>{if(!supabase)return;const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error;navigationContext.activate(null);setSession(null);setProfile(null);setRecovery(false);};
 if(demoMode&&import.meta.env.DEV)return children(demoProfile,async()=>{},()=>{});
 if(loading||(session&&profile&&session.user.id!==profile.id))return session?<><SuiteHeader app="Inventory" name={profile?.displayName} onSignOut={()=>void signOut().catch(e=>setError(friendlyError(e)))}/><p role="status">Loading…</p></>:<AuthSurface/>;
 if(configurationError||!supabase)return <AuthSurface><p role="alert">Unable to connect securely. Please try again.</p><a href="https://team.frc4418.org/">Team sign in</a></AuthSurface>;
 if(recovery&&session)return <PasswordForm signOut={signOut} done={()=>location.replace('https://team.frc4418.org/')}/>;
 if(!session)return <LoginForm/>;
 if(!profile||!profile.active)return <><SuiteHeader app="Inventory" name={profile?.displayName} onSignOut={()=>void signOut().catch(e=>setError(friendlyError(e)))}/><section className="auth-card"><p role="alert">{profile?'Your account is inactive. Ask a mentor to restore access.':error}</p><button className="secondary" onClick={()=>location.reload()}>Retry</button></section></>;
 return children(profile,signOut,setProfile);
}
function AuthFrame({children,account}:{children:ReactNode;account?:ReactNode}){return <AuthSurface>{children}{account}</AuthSurface>;}
function PasswordForm({done,signOut}:{done:()=>void;signOut:()=>Promise<void>}){
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <AuthFrame account={<button onClick={()=>void signOut().catch(e=>setError(friendlyError(e)))}>Sign out</button>}><form className="auth-form" onSubmit={async e=>{e.preventDefault();if(password!==confirm){setError('Passwords must match.');return;}setBusy(true);const {error}=await supabase!.auth.updateUser({password});if(error)setError(friendlyError(error));else done();setBusy(false);}}><h2>Set your password</h2><label>New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirm password<input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<button className="primary" disabled={busy}>Save password</button></form></AuthFrame>;
}

function LoginForm(){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <AuthSurface><h1>Inventory sign in</h1><form className="auth-form" onSubmit={async e=>{
  e.preventDefault();if(busy)return;const form=new FormData(e.currentTarget);setBusy(true);setError('');
  try{const {error}=await supabase!.auth.signInWithPassword({email:String(form.get('email')||'').trim(),password:String(form.get('password')||'')});if(error)setError(friendlyError(error));}
  catch(e){setError(friendlyError(e));}finally{setBusy(false);}
 }}><label>Team account email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error&&<p role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?'Signing in…':'Sign in'}</button><p>Use your Team 4418 account. <a href="https://team.frc4418.org/">Team Hub and password help</a></p></form></AuthSurface>;
}
