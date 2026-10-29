-- Shadow Hunt starter schema for Supabase.
-- Enable Anonymous Sign-ins in Supabase Auth before using this app.
-- Review/test RLS policies with a security professional before a public launch.

create extension if not exists pgcrypto;

create table if not exists public.hunt_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,8}$'),
  campus text not null default 'University campus',
  host_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby','running','ended')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ends_at timestamptz
);

create table if not exists public.hunt_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.hunt_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  role text not null check (role in ('hunter','shadow')),
  status text not null default 'Joined' check (status in ('Joined','In play','Caught','Escaped','Left')),
  location_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  unique(room_id,user_id)
);

create index if not exists hunt_players_room_idx on public.hunt_players(room_id);

alter table public.hunt_rooms enable row level security;
alter table public.hunt_players enable row level security;

-- Room code is a lobby credential; only current room members can read room data.
create policy "members can read their room"
on public.hunt_rooms for select to authenticated
using (exists (select 1 from public.hunt_players p where p.room_id = id and p.user_id = auth.uid()));

create policy "host can update their room"
on public.hunt_rooms for update to authenticated
using (host_user_id = auth.uid())
with check (host_user_id = auth.uid());

create policy "members can read roster"
on public.hunt_players for select to authenticated
using (exists (select 1 from public.hunt_players mine where mine.room_id = room_id and mine.user_id = auth.uid()));

create policy "players can update their own presence"
on public.hunt_players for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Creation and joining are RPCs so clients cannot choose another user's ID.
create or replace function public.create_hunt_room(
  p_code text, p_campus text, p_display_name text, p_role text
) returns table(room_id uuid, room_code text, campus text, player_id uuid)
language plpgsql security definer set search_path = public
as $$
declare r public.hunt_rooms; p public.hunt_players;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_role not in ('hunter','shadow') then raise exception 'Invalid role'; end if;
  if length(trim(p_display_name)) not between 1 and 20 then raise exception 'Name must be 1-20 characters'; end if;
  insert into public.hunt_rooms(code,campus,host_user_id)
    values (upper(p_code), coalesce(nullif(trim(p_campus),''),'University campus'), auth.uid())
    returning * into r;
  insert into public.hunt_players(room_id,user_id,display_name,role,status)
    values (r.id,auth.uid(),trim(p_display_name),p_role,'Joined')
    returning * into p;
  return query select r.id,r.code,r.campus,p.id;
end $$;

create or replace function public.join_hunt_room(
  p_code text, p_display_name text, p_role text
) returns table(room_id uuid, room_code text, campus text, player_id uuid)
language plpgsql security definer set search_path = public
as $$
declare r public.hunt_rooms; p public.hunt_players;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_role not in ('hunter','shadow') then raise exception 'Invalid role'; end if;
  if length(trim(p_display_name)) not between 1 and 20 then raise exception 'Name must be 1-20 characters'; end if;
  select * into r from public.hunt_rooms where code=upper(trim(p_code)) and status='lobby';
  if not found then raise exception 'Room not found or game already started'; end if;
  insert into public.hunt_players(room_id,user_id,display_name,role,status)
    values (r.id,auth.uid(),trim(p_display_name),p_role,'Joined')
    on conflict (room_id,user_id) do update set display_name=excluded.display_name, role=excluded.role
    returning * into p;
  return query select r.id,r.code,r.campus,p.id;
end $$;

revoke all on function public.create_hunt_room(text,text,text,text) from public;
revoke all on function public.join_hunt_room(text,text,text) from public;
grant execute on function public.create_hunt_room(text,text,text,text) to authenticated;
grant execute on function public.join_hunt_room(text,text,text) to authenticated;

-- IMPORTANT: Configure Realtime Authorization for private channels in Supabase.
-- Use topic format "hunt:<room UUID>" and permit access only to authenticated room members.
-- Do not make player_location broadcasts public.
-- This starter intentionally does not persist GPS coordinates in a table.


-- Harden client updates: do not allow clients to change room membership, role,
-- user_id, or room_id by editing their own player row.
revoke update on public.hunt_players from authenticated;
grant update(display_name, status, location_opt_in) on public.hunt_players to authenticated;

create or replace function public.set_location_opt_in(
  p_player_id uuid, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public
as $$
declare p public.hunt_players; r public.hunt_rooms;
begin
  select * into p from public.hunt_players
    where id=p_player_id and user_id=auth.uid();
  if not found then raise exception 'Player membership not found'; end if;
  select * into r from public.hunt_rooms where id=p.room_id;
  if p.role <> 'shadow' then raise exception 'Only Shadows can opt in to location sharing'; end if;
  if p_enabled and r.status <> 'running' then raise exception 'Location sharing is only available during an active game'; end if;
  update public.hunt_players set location_opt_in=p_enabled where id=p.id;
end $$;
revoke all on function public.set_location_opt_in(uuid,boolean) from public;
grant execute on function public.set_location_opt_in(uuid,boolean) to authenticated;

-- Realtime policies for the Hunter-only location feed.
-- Shadows publish GPS through the Edge Function; they never subscribe to this feed.
create policy "authorised Hunters can receive shadow location feed"
on realtime.messages for select to authenticated
using (
  realtime.topic() like 'hunt-location:%'
  and exists (
    select 1
    from public.hunt_rooms r
    join public.hunt_players p on p.room_id = r.id
    where r.id = split_part(realtime.topic(), ':', 2)::uuid
      and p.user_id = auth.uid()
      and p.role = 'hunter'
      and r.status = 'running'
  )
);
