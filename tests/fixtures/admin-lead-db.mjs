import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
export const sql=async name=>readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
export async function adapterSql(){const names=(await readdir(new URL('../../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('_inventory_admin_lead_compatibility.sql'));if(names.length!==1)throw Error('Exactly one canonical Inventory adapter required');return sql(names[0]);}
export const ids=Object.fromEntries(['mentor','admin','student','lead','readonly','inactive','adminLead','unassigned','assigned','inactiveLead','revoked','pending','assignedStudent'].map((n,i)=>[n,`00000000-0000-4000-8000-${String(i+101).padStart(12,'0')}`]));
export const area='44180000-0000-4000-8000-000000000001',other='44180000-0000-4000-8000-000000000002';
export const home='10000000-0000-4000-8000-000000000101',destination='10000000-0000-4000-8000-000000000102';
// Test-only schema prerequisite. The actual central Hub migration owns the
// production profile CHECK and management/position guard; integration is separate.
export async function allowRole(db){await db.exec("alter table profiles drop constraint profiles_role_check;alter table profiles add constraint profiles_role_check check(role in ('readonly','student','lead','admin_lead','admin','mentor'));");}
export const createRoleDb=()=>setupRoleDb(new PGlite());
export async function setupRoleDb(db){
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',last_sign_in_at timestamptz default now(),email_confirmed_at timestamptz default now(),banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users(id,email) values($1,$2)',[id,name+'@example.invalid']);
 for(const n of ['001_initial_schema.sql','002_rls_policies.sql','003_operations_and_seed.sql','004_balances_travel_media.sql','005_private_inventory_media.sql','20261021021658_student_item_creation.sql','20261028020953_lead_item_creation.sql'])await db.exec(await sql(n));
 await allowRole(db);
 for(const [who,id]of Object.entries(ids))await db.query('update profiles set role=$1,active=$2,primary_area_id=$3 where id=$4',[['mentor','admin','student','lead','readonly'].includes(who)?who:['inactive','assignedStudent'].includes(who)?'student':'admin_lead',!['inactive','inactiveLead'].includes(who),['lead','adminLead','inactiveLead'].includes(who)?area:null,id]);
 await db.query("insert into locations(id,name,code,location_type,area_id) values($1,'Synthetic home','S-HOME','Drawer',$3),($2,'Synthetic destination','S-DEST','Storage',$4)",[home,destination,area,other]);
 await db.exec(`create table team_positions(key text primary key,active boolean not null default true);
 create table team_member_positions(user_id uuid references profiles,position_key text references team_positions,revoked_at timestamptz);
 create table team_attendance_members(student_id uuid primary key references profiles,member_status text not null);
 alter table team_positions enable row level security;alter table team_member_positions enable row level security;alter table team_attendance_members enable row level security;
 revoke all on team_positions,team_member_positions,team_attendance_members from public,anon,authenticated;
 insert into team_positions(key) values('software_lead');`);
 for(const who of ['assigned','revoked','pending','assignedStudent','readonly'])await db.query("insert into team_member_positions values($1,'software_lead',$2)",[ids[who],who==='revoked'?new Date():null]);
 await db.query('update auth.users set last_sign_in_at=null where id=$1',[ids.pending]);
 await db.query("insert into team_attendance_members values($1,'prospective')",[ids.student]);
 for(const n of ['20261028011601_assigned_student_lead_location_creation.sql','20261028020701_normal_location_types_and_rename.sql'])await db.exec(await sql(n));
 return db;
}
export const as=(db,who,fn)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[ids[who]??who]);return fn(tx);});
export const action=(db,who,name,data)=>as(db,who,tx=>tx.query('select inventory_action($1,$2) result',[name,JSON.stringify(data)]));
export const item=async(db,who='mentor',target=area)=>(await as(db,who,tx=>tx.query("insert into inventory_items(name,area_id,category,quantity,location_id) values('Synthetic role item',$1,'Tools',6,$2) returning id",[target,home]))).rows[0].id;
