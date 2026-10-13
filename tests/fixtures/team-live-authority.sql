-- Read-only Team Hub authority snapshot supplied by the independent review, 2026-10-12.
create or replace function public.team_my_positions() returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(mp.position_key order by mp.position_key),'{}') from public.team_member_positions mp
 join public.team_positions pos on pos.key=mp.position_key and pos.active
 join public.profiles pr on pr.id=mp.user_id and pr.active and pr.role::text in ('student','lead','mentor','admin')
 where mp.user_id=auth.uid() and mp.revoked_at is null $$;
CREATE OR REPLACE FUNCTION public.team_has_any_position(keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(public.team_my_positions() && keys,false)
$function$
;
CREATE OR REPLACE FUNCTION public.team_has_position(key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.team_has_any_position(array[key])
$function$
;
