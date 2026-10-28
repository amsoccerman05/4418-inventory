-- Apply after the central shared profile role migration. No user conversion,
-- role assignment, grants, policies or shared position/profile guards change.
-- Admin Lead inherits exactly existing Student and Lead Inventory capabilities.
-- Metadata/media/item deletion stay own-area; existing manifest approval is
-- team-wide. No global Inventory, location, trip or loss-resolution admin grant.
begin;
do $migration$
declare entry record; definition text; count_matches integer;
begin
 if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and contype='c' and position('admin_lead' in pg_get_constraintdef(oid))>0) then
  raise exception 'Apply the central Admin Lead profile-role migration first';
 end if;
 for entry in select * from (values
  ('public.inventory_action(text,jsonb)','8a262d3eb9987b4f51321d753b784048','1ddface6796b047686122bea43b19db5',$old$private.current_role()='lead'$old$,$new$private.current_role() in ('lead','admin_lead')$new$,3),
  ('private.can_count()','b666ad7d08e63f94802c5c2d20c4d57b','e55d4ae6c0b0426bfca7b8525950951a',$old$in ('student','lead','admin','mentor')$old$,$new$in ('student','lead','admin_lead','admin','mentor')$new$,1),
  ('private.can_create_assigned_lead_location()','45179a2e6e3a4cb65f92aea5871d9f05','aa561c27b82305a453570c14788f24ad',$old$p.role::text in ('student','lead')$old$,$new$p.role::text in ('student','lead','admin_lead')$new$,1),
  ('private.can_create_item(uuid)','b685cbee4dfabd0b335ab4e70efd4b50','64be9049c94f36b380cf13f380b76093',$old$in ('student','lead')$old$,$new$in ('student','lead','admin_lead')$new$,1),
  ('private.can_edit(uuid)','a7e467b6195a0208627677ec852e199a','54c7476cc03f4f05cb24243396f04937',$old$private.current_role()='lead'$old$,$new$private.current_role() in ('lead','admin_lead')$new$,1),
  ('private.can_manage_media(text,uuid)','349c28da89eb7bc5aa79de4bda9316b0','6e47c64935af7dcdc5faf04cda419265',$old$private.current_role()='lead'$old$,$new$private.current_role() in ('lead','admin_lead')$new$,1)
 ) as replacements(signature,before_md5,after_md5,old_text,new_text,expected_count) loop
  definition:=pg_get_functiondef(entry.signature::regprocedure);
  -- Pin the complete reviewed definition, not just a role-predicate count.
  if md5(definition)<>entry.before_md5 then raise exception 'Inventory full definition drift in %; review before applying',entry.signature;end if;
  count_matches:=(length(definition)-length(replace(definition,entry.old_text,'')))/length(entry.old_text);
  if count_matches<>entry.expected_count then raise exception 'Inventory role predicate drift in %',entry.signature;end if;
  execute replace(definition,entry.old_text,entry.new_text);
  if md5(pg_get_functiondef(entry.signature::regprocedure))<>entry.after_md5 then raise exception 'Inventory output definition mismatch in %',entry.signature;end if;
 end loop;
end
$migration$;
commit;
