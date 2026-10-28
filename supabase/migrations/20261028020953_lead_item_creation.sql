begin;

-- Lead is a superset of Student for creation. Area assignment still controls
-- metadata editing, deletion and media through the unchanged can_edit helper.
-- Existing insert RLS and guard_item already call this creation-only helper.
create or replace function private.can_create_item(area uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(private.current_role() in ('student','lead'),false)
     or coalesce(private.can_edit(area),false)
$$;
revoke all on function private.can_create_item(uuid) from public,anon;
grant execute on function private.can_create_item(uuid) to authenticated;

commit;
