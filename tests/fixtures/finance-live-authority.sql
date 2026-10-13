-- Read-only snapshot from shared project's definitions, 2026-10-12. Test fixture only.
CREATE OR REPLACE FUNCTION finance_private.cap(c text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case c when 'finance_approver' then public.team_has_position('finance_lead')
 when 'po_approver' then public.team_has_any_position(array['lead_coach_1','lead_coach_2'])
 else coalesce(finance_private.role() in ('student','lead','admin','mentor'),false) and exists(select 1 from public.finance_assignments where user_id=auth.uid() and capability=c and active) end
$function$
;
CREATE OR REPLACE FUNCTION finance_private.creator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    finance_private.admin()
    or finance_private.role() in ('lead', 'student'),
    false
  )
$function$
;
CREATE OR REPLACE FUNCTION finance_private.mutate_v1(action text, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare po public.finance_purchase_orders; previous jsonb; pid uuid; slot text:=p->>'slot'; reason text:=trim(coalesce(p->>'reason','')); override_note text:=trim(coalesce(p->>'override_reason','')); caps boolean;
begin
 if finance_private.role() is null then raise exception 'Active team account required' using errcode='42501'; end if;
 if length(reason)>2000 or length(override_note)>2000 then raise exception 'Explanations must be at most 2000 characters'; end if;
 if action='assignment' then
 if p->>'capability' is null or p->>'capability' not in ('school_submitter','finance_admin') then raise exception 'Manage Lead Coach and Finance Lead positions in Team Hub'; end if;
 if not finance_private.admin() then raise exception 'Finance administration required' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=(p->>'user_id')::uuid and active and role::text in ('student','lead','admin','mentor')) then raise exception 'Choose an active student or leadership account'; end if;
 if reason='' then raise exception 'Assignment explanation required'; end if;
 insert into public.finance_assignments(user_id,capability,active,assigned_by) values((p->>'user_id')::uuid,p->>'capability',(p->>'active')::boolean,auth.uid())
 on conflict(user_id,capability) do update set active=excluded.active,assigned_by=auth.uid(),assigned_at=clock_timestamp() returning id into pid;
 insert into finance_private.history(action,actor_id,details) values('assignment',auth.uid(),jsonb_build_object('assignment_id',pid,'user_id',p->>'user_id','capability',p->>'capability','active',p->'active','reason',reason));return pid;
 end if;
 if action='create' then
 if not finance_private.creator() then raise exception 'Registered student or leadership access required' using errcode='42501'; end if;
 if not exists(select 1 from public.areas where id=(p->>'area_id')::uuid and active) then raise exception 'Choose an active team area'; end if;
 insert into public.finance_purchase_orders(requester_id,area_id,sheet_url,vendor,amount,purpose,notes,needed_by)
 values(auth.uid(),(p->>'area_id')::uuid,trim(p->>'sheet_url'),trim(p->>'vendor'),(p->>'amount')::numeric,trim(p->>'purpose'),coalesce(p->>'notes',''),nullif(p->>'needed_by','')::date) returning * into po;
 insert into finance_private.history(po_id,revision,action,actor_id,details) values(po.id,0,'created',auth.uid(),to_jsonb(po)); return po.id;
 end if;
 pid:=(p->>'id')::uuid;
 if not finance_private.visible(pid) then raise exception 'Purchase order unavailable' using errcode='42501'; end if;
 select * into po from public.finance_purchase_orders where id=pid for update;
 previous:=to_jsonb(po);
 if po.version is distinct from (p->>'version')::integer then raise exception 'This PO changed. Refresh before acting.'; end if;
 if action in ('edit','submit','cancel') then
 if po.requester_id<>auth.uid() and not finance_private.admin() then raise exception 'Requester or Finance administrator required' using errcode='42501'; end if;
 if po.status in ('submitted_to_school','cancelled') then raise exception 'This PO is locked'; end if;
 if action='edit' then
 if not exists(select 1 from public.areas where id=(p->>'area_id')::uuid and active) then raise exception 'Choose an active team area'; end if;
 update public.finance_purchase_orders set area_id=(p->>'area_id')::uuid,sheet_url=trim(p->>'sheet_url'),vendor=trim(p->>'vendor'),amount=(p->>'amount')::numeric,
 purpose=trim(p->>'purpose'),notes=coalesce(p->>'notes',''),needed_by=nullif(p->>'needed_by','')::date,status='draft' where id=pid;
 elsif action='submit' then
 if po.status not in ('draft','changes_requested') then raise exception 'Only drafts or requested changes can be submitted'; end if;
 update public.finance_purchase_orders set revision=revision+1,status='awaiting_approval',submitted_at=clock_timestamp() where id=pid returning * into po;
 insert into public.finance_po_revisions(po_id,revision,metadata,submitted_by) values(pid,po.revision,to_jsonb(po),auth.uid());
 else
 if reason='' then raise exception 'Cancellation explanation required'; end if;
 update public.finance_purchase_orders set status='cancelled' where id=pid;
 end if;
 elsif action in ('approve','request_changes') then
 if po.status<>'awaiting_approval' then raise exception 'PO is not awaiting approval'; end if;
 if exists(select 1 from public.finance_po_approvals a where a.po_id=pid and a.revision=po.revision and a.action='changes_requested') then raise exception 'This revision requires resubmission'; end if;
 if slot is null or slot not in ('finance_approver','po_approver') then raise exception 'Choose an approval slot'; end if;
 -- Emergency exception: an active mentor/admin may replace ONE position-based
 -- approver (including on their own PO) only with an explicit override reason.
 -- The same actor can NEVER approve both slots, including through overrides.
 caps:=finance_private.cap(slot);
 if (not caps or po.requester_id=auth.uid()) and not (finance_private.role() in ('admin','mentor') and override_note<>'') then raise exception 'Configured approver required; administrators must give an explicit override reason' using errcode='42501'; end if;
 if override_note<>'' and finance_private.role() not in ('admin','mentor') then raise exception 'Only mentors and admins can override' using errcode='42501'; end if;
 if action='request_changes' and reason='' then raise exception 'Explain the requested changes'; end if;
 if action='approve' and exists(select 1 from public.finance_po_approvals a where a.po_id=pid and a.revision=po.revision and a.action='approved' and a.actor_id=auth.uid()) then raise exception 'Two distinct people must approve each revision'; end if;
 insert into public.finance_po_approvals(po_id,revision,slot,action,actor_id,explanation,override_reason)
 values(pid,po.revision,slot,case when action='approve' then 'approved' else 'changes_requested' end,auth.uid(),reason,override_note);
 update public.finance_purchase_orders set status=case when action='request_changes' then 'changes_requested'
 when finance_private.revision_approved(pid,po.revision) then 'approved' else 'awaiting_approval' end where id=pid;
 elsif action='school_submit' then
 if not (finance_private.cap('school_submitter') or finance_private.role() in ('admin','mentor')) then raise exception 'School submission capability required' using errcode='42501'; end if;
 if po.status<>'approved' or not finance_private.revision_approved(pid,po.revision) then raise exception 'Both current-revision approvals are required'; end if;
 update public.finance_purchase_orders set status='submitted_to_school',school_submitted_by=auth.uid(),school_submitted_at=clock_timestamp(),school_reference=trim(coalesce(p->>'reference','')),school_note=trim(coalesce(p->>'note','')) where id=pid;
 else raise exception 'Unknown Finance action'; end if;
 update public.finance_purchase_orders set version=version+1,updated_at=clock_timestamp() where id=pid;
 insert into finance_private.history(po_id,revision,action,actor_id,details)
 select pid,revision,action,auth.uid(),jsonb_build_object('reason',reason,'slot',slot,'override_reason',override_note,'self_approval_override',action='approve' and po.requester_id=auth.uid(),'before',previous,'after',to_jsonb(n)) from public.finance_purchase_orders n where id=pid;
 return pid;
end $function$
;
