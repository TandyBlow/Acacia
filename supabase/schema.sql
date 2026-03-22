-- SeeWhat schema and RPC for Supabase
-- Run this file in Supabase SQL Editor.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  content jsonb not null default jsonb_build_object('markdown', ''),
  ai_summary text,
  embedding vector(1536),
  depth integer not null default 0 check (depth >= 0 and depth <= 64),
  parent_id_cache uuid,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.edges (
  parent_id uuid references public.nodes(id) on delete cascade,
  child_id uuid not null unique references public.nodes(id) on delete cascade,
  relationship_type text not null default 'contains',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (parent_id, child_id)
);

create index if not exists idx_edges_parent_sort on public.edges(parent_id, sort_order);
create index if not exists idx_edges_child on public.edges(child_id);
create index if not exists idx_nodes_owner on public.nodes(owner_id);
create index if not exists idx_nodes_parent_cache on public.nodes(parent_id_cache);
create index if not exists idx_nodes_owner_parent_cache on public.nodes(owner_id, parent_id_cache);
create unique index if not exists uniq_nodes_parent_name_active
  on public.nodes(owner_id, parent_id_cache, name)
  where is_deleted = false;
create index if not exists idx_nodes_embedding_hnsw
  on public.nodes using hnsw (embedding vector_cosine_ops);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_nodes_set_updated_at on public.nodes;
create trigger trg_nodes_set_updated_at
before update on public.nodes
for each row
execute function public.set_updated_at();

create or replace function public.validate_edge_insert()
returns trigger
language plpgsql
as $$
declare
  cycle_exists boolean;
  parent_depth integer;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.child_id then
    raise exception 'parent_id cannot equal child_id';
  end if;

  with recursive ancestors as (
    select e.parent_id, e.child_id
    from public.edges e
    where e.child_id = new.parent_id
    union all
    select e.parent_id, e.child_id
    from public.edges e
    join ancestors a on e.child_id = a.parent_id
  )
  select exists(
    select 1
    from ancestors
    where parent_id = new.child_id or child_id = new.child_id
  )
  into cycle_exists;

  if cycle_exists then
    raise exception 'Cycle detected: cannot move node into itself or descendants';
  end if;

  select coalesce(n.depth, -1)
  into parent_depth
  from public.nodes n
  where n.id = new.parent_id;

  if parent_depth >= 63 then
    raise exception 'Max depth limit reached (64)';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_edges_validate on public.edges;
create trigger trg_edges_validate
before insert or update on public.edges
for each row
execute function public.validate_edge_insert();

create or replace function public.refresh_subtree_depth(root_node_id uuid)
returns void
language plpgsql
as $$
declare
  base_depth integer := 0;
begin
  select coalesce(parent.depth + 1, 0)
  into base_depth
  from public.edges e
  left join public.nodes parent on parent.id = e.parent_id
  where e.child_id = root_node_id;

  with recursive walk as (
    select n.id, 0 as rel_depth
    from public.nodes n
    where n.id = root_node_id
    union all
    select c.id, w.rel_depth + 1
    from walk w
    join public.edges e on e.parent_id = w.id
    join public.nodes c on c.id = e.child_id and c.is_deleted = false
  )
  update public.nodes n
  set depth = base_depth + w.rel_depth
  from walk w
  where n.id = w.id;
end;
$$;

create or replace function public.sync_node_cache_after_edge()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    update public.nodes
    set parent_id_cache = new.parent_id
    where id = new.child_id;
    perform public.refresh_subtree_depth(new.child_id);
  elsif tg_op = 'DELETE' then
    update public.nodes
    set parent_id_cache = null,
        depth = 0
    where id = old.child_id;
    perform public.refresh_subtree_depth(old.child_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_edges_sync_cache on public.edges;
create trigger trg_edges_sync_cache
after insert or update or delete on public.edges
for each row
execute function public.sync_node_cache_after_edge();

create or replace function public.get_node_context(target_id uuid default null)
returns jsonb
language sql
stable
as $$
  with node_info as (
    select n.id, n.name, n.content, n.parent_id_cache as parent_id, n.depth, 0 as sort_order
    from public.nodes n
    where target_id is not null
      and n.id = target_id
      and n.is_deleted = false
  ),
  path_nodes as (
    with recursive chain as (
      select p.id, p.name, p.content, p.parent_id_cache as parent_id, p.depth
      from public.nodes cur
      join public.edges e on e.child_id = cur.id
      join public.nodes p on p.id = e.parent_id
      where cur.id = target_id and cur.is_deleted = false
      union all
      select p2.id, p2.name, p2.content, p2.parent_id_cache as parent_id, p2.depth
      from chain c
      join public.edges e2 on e2.child_id = c.id
      join public.nodes p2 on p2.id = e2.parent_id
      where p2.is_deleted = false
    )
    select distinct on (id) *
    from chain
    order by id, depth
  ),
  children as (
    select n.id, n.name, n.content, e.parent_id, n.depth, e.sort_order
    from public.nodes n
    join public.edges e on e.child_id = n.id
    where n.is_deleted = false
      and (
        (target_id is null and e.parent_id is null)
        or (target_id is not null and e.parent_id = target_id)
      )
    order by e.sort_order, n.created_at
  )
  select jsonb_build_object(
    'node_info',
      case
        when target_id is null then null
        else (select to_jsonb(ni) from node_info ni)
      end,
    'path_nodes',
      coalesce(
        (
          select jsonb_agg(to_jsonb(pn) order by pn.depth)
          from path_nodes pn
        ),
        '[]'::jsonb
      ),
    'children',
      coalesce(
        (
          select jsonb_agg(to_jsonb(c) order by c.sort_order)
          from children c
        ),
        '[]'::jsonb
      )
  );
$$;

create or replace function public.create_node(input_parent_id uuid, input_name text)
returns table (
  id uuid,
  name text,
  content jsonb,
  parent_id uuid,
  sort_order integer
)
language plpgsql
as $$
declare
  new_id uuid;
  next_sort integer := 0;
begin
  if length(trim(input_name)) = 0 then
    raise exception 'Node name is required';
  end if;

  select coalesce(max(e.sort_order) + 1, 0)
  into next_sort
  from public.edges e
  where e.parent_id is not distinct from input_parent_id;

  insert into public.nodes (name, parent_id_cache)
  values (trim(input_name), input_parent_id)
  returning nodes.id into new_id;

  insert into public.edges (parent_id, child_id, sort_order)
  values (input_parent_id, new_id, next_sort);

  return query
  select n.id, n.name, n.content, n.parent_id_cache as parent_id, e.sort_order
  from public.nodes n
  left join public.edges e on e.child_id = n.id
  where n.id = new_id;
end;
$$;

create or replace function public.update_node_content(input_node_id uuid, input_content jsonb)
returns void
language plpgsql
as $$
begin
  update public.nodes
  set content = coalesce(input_content, jsonb_build_object('markdown', '')),
      updated_at = now()
  where id = input_node_id
    and is_deleted = false;
end;
$$;

create or replace function public.delete_node(target_id uuid, delete_children boolean default false)
returns void
language plpgsql
as $$
declare
  old_parent uuid;
  child_row record;
  next_sort integer;
begin
  if target_id is null then
    raise exception 'target_id is required';
  end if;

  select parent_id into old_parent
  from public.edges
  where child_id = target_id;

  if delete_children then
    with recursive subtree as (
      select target_id as id
      union all
      select e.child_id
      from subtree s
      join public.edges e on e.parent_id = s.id
    )
    update public.nodes n
    set is_deleted = true,
        updated_at = now()
    where n.id in (select id from subtree);

    delete from public.edges
    where child_id in (
      with recursive subtree as (
        select target_id as id
        union all
        select e.child_id
        from subtree s
        join public.edges e on e.parent_id = s.id
      )
      select id from subtree
    )
    or parent_id in (
      with recursive subtree as (
        select target_id as id
        union all
        select e.child_id
        from subtree s
        join public.edges e on e.parent_id = s.id
      )
      select id from subtree
    );
    return;
  end if;

  select coalesce(max(sort_order) + 1, 0)
  into next_sort
  from public.edges
  where parent_id is not distinct from old_parent;

  for child_row in
    select child_id
    from public.edges
    where parent_id = target_id
    order by sort_order
  loop
    update public.edges
    set parent_id = old_parent,
        sort_order = next_sort
    where child_id = child_row.child_id;
    next_sort := next_sort + 1;
  end loop;

  delete from public.edges
  where child_id = target_id;

  update public.nodes
  set is_deleted = true,
      updated_at = now()
  where id = target_id;
end;
$$;

create or replace function public.move_node(target_id uuid, new_parent_id uuid)
returns void
language plpgsql
as $$
declare
  target_name text;
  duplicate_exists boolean;
  next_sort integer;
begin
  if target_id is null then
    raise exception 'target_id is required';
  end if;

  if new_parent_id = target_id then
    raise exception 'Cannot move a node under itself';
  end if;

  if new_parent_id is not null then
    with recursive subtree as (
      select target_id as id
      union all
      select e.child_id
      from subtree s
      join public.edges e on e.parent_id = s.id
    )
    select exists(select 1 from subtree where id = new_parent_id)
    into duplicate_exists;

    if duplicate_exists then
      raise exception 'Cannot move a node under its descendants';
    end if;
  end if;

  select n.name
  into target_name
  from public.nodes n
  where n.id = target_id and n.is_deleted = false;

  select exists(
    select 1
    from public.nodes n
    where n.parent_id_cache is not distinct from new_parent_id
      and n.name = target_name
      and n.id <> target_id
      and n.is_deleted = false
  )
  into duplicate_exists;

  if duplicate_exists then
    raise exception 'A node with same name already exists under target parent';
  end if;

  select coalesce(max(e.sort_order) + 1, 0)
  into next_sort
  from public.edges e
  where e.parent_id is not distinct from new_parent_id;

  update public.edges
  set parent_id = new_parent_id,
      sort_order = next_sort
  where child_id = target_id;
end;
$$;

create or replace function public.get_tree()
returns table (
  id uuid,
  name text,
  parent_id uuid,
  sort_order integer
)
language sql
stable
as $$
  select
    n.id,
    n.name,
    e.parent_id,
    coalesce(e.sort_order, 0) as sort_order
  from public.nodes n
  left join public.edges e on e.child_id = n.id
  where n.is_deleted = false
  order by coalesce(n.depth, 0), e.parent_id, coalesce(e.sort_order, 0), n.created_at;
$$;


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
