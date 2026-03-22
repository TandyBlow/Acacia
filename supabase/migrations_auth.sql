-- One-time migration for auth + ownership isolation
-- Target account
-- username: hongxintt
-- synthetic email: u.7b66b4cb0ad2b4cf8c53c5fe0cf28da33110da6ef58c03089facf68bd53ee852@seewhat.local

alter table public.nodes
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.nodes
  add column if not exists parent_id_cache uuid;

alter table public.nodes
  add column if not exists is_deleted boolean not null default false;

update public.nodes n
set parent_id_cache = e.parent_id
from public.edges e
where e.child_id = n.id
  and n.parent_id_cache is distinct from e.parent_id;

create index if not exists idx_nodes_owner on public.nodes(owner_id);
create index if not exists idx_nodes_owner_parent_cache on public.nodes(owner_id, parent_id_cache);

drop index if exists uniq_nodes_parent_name_active;
create unique index if not exists uniq_nodes_parent_name_active
  on public.nodes(owner_id, parent_id_cache, name)
  where is_deleted = false;

do $$
declare
  target_user uuid;
begin
  select u.id
  into target_user
  from auth.users u
  where u.email = 'u.7b66b4cb0ad2b4cf8c53c5fe0cf28da33110da6ef58c03089facf68bd53ee852@seewhat.local'
  limit 1;

  if target_user is null then
    raise exception 'Target user hongxintt was not found. Create this user first in Authentication > Users.';
  end if;

  update public.nodes
  set owner_id = target_user
  where owner_id is null;
end
$$;

alter table public.nodes
  alter column owner_id set default auth.uid();

alter table public.nodes
  alter column owner_id set not null;

alter table public.nodes enable row level security;
alter table public.edges enable row level security;

drop policy if exists nodes_select_own on public.nodes;
drop policy if exists nodes_insert_own on public.nodes;
drop policy if exists nodes_update_own on public.nodes;
drop policy if exists nodes_delete_own on public.nodes;

create policy nodes_select_own
on public.nodes
for select
using (owner_id = auth.uid());

create policy nodes_insert_own
on public.nodes
for insert
with check (owner_id = auth.uid());

create policy nodes_update_own
on public.nodes
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy nodes_delete_own
on public.nodes
for delete
using (owner_id = auth.uid());

drop policy if exists edges_select_own on public.edges;
drop policy if exists edges_insert_own on public.edges;
drop policy if exists edges_update_own on public.edges;
drop policy if exists edges_delete_own on public.edges;

create policy edges_select_own
on public.edges
for select
using (
  exists (
    select 1
    from public.nodes child
    where child.id = edges.child_id
      and child.owner_id = auth.uid()
      and child.is_deleted = false
  )
);

create policy edges_insert_own
on public.edges
for insert
with check (
  exists (
    select 1
    from public.nodes child
    where child.id = edges.child_id
      and child.owner_id = auth.uid()
      and child.is_deleted = false
  )
  and (
    edges.parent_id is null
    or exists (
      select 1
      from public.nodes parent
      where parent.id = edges.parent_id
        and parent.owner_id = auth.uid()
        and parent.is_deleted = false
    )
  )
);

create policy edges_update_own
on public.edges
for update
using (
  exists (
    select 1
    from public.nodes child
    where child.id = edges.child_id
      and child.owner_id = auth.uid()
      and child.is_deleted = false
  )
)
with check (
  exists (
    select 1
    from public.nodes child
    where child.id = edges.child_id
      and child.owner_id = auth.uid()
      and child.is_deleted = false
  )
  and (
    edges.parent_id is null
    or exists (
      select 1
      from public.nodes parent
      where parent.id = edges.parent_id
        and parent.owner_id = auth.uid()
        and parent.is_deleted = false
    )
  )
);

create policy edges_delete_own
on public.edges
for delete
using (
  exists (
    select 1
    from public.nodes child
    where child.id = edges.child_id
      and child.owner_id = auth.uid()
      and child.is_deleted = false
  )
);
