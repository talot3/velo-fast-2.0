-- VELO FAST: banco compartilhado para Vercel + agente local de impressão
create table if not exists public.velo_app_state (
  store_id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.velo_print_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','printed','failed')),
  claimed_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists velo_print_jobs_pending_idx
  on public.velo_print_jobs (store_id, status, created_at);

create or replace function public.velo_claim_print_job(p_store_id text)
returns setof public.velo_print_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.velo_print_jobs
     set status = 'processing', claimed_at = now()
   where id = (
     select id from public.velo_print_jobs
      where store_id = p_store_id
        and status = 'pending'
      order by created_at
      for update skip locked
      limit 1
   )
  returning *;
end;
$$;

-- A API usa a service role; estas políticas mantêm o acesso público bloqueado.
alter table public.velo_app_state enable row level security;
alter table public.velo_print_jobs enable row level security;

create table if not exists public.velo_stores (
  id text primary key,
  name text not null,
  cnpj text,
  phone text,
  active boolean not null default true,
  expire_date date,
  terminals_allowed integer not null default 5,
  active_terminals integer not null default 1,
  created_at timestamptz not null default now()
);

alter table public.velo_stores enable row level security;
