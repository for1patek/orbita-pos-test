-- Ejecutar UNA VEZ en Supabase: SQL Editor → New query → Run
-- Proyecto: uldqgxdmblhyqsnxenaz (mismo que usan las páginas HTML)

create table if not exists public.orbita_config (
  clave text primary key,
  valor bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.orbita_config (clave, valor) values
  ('costo_fijo_handroll', 0),
  ('costo_fijo_cafe', 0),
  ('costo_fijo_fuente', 0)
on conflict (clave) do nothing;

alter table public.orbita_config enable row level security;

-- Lectura y escritura con la anon key (igual que pedidos en el front).
-- Si prefieres restringir esto, cambia a service role + Edge Function.
create policy "orbita_config_select" on public.orbita_config
  for select using (true);

create policy "orbita_config_insert" on public.orbita_config
  for insert with check (true);

create policy "orbita_config_update" on public.orbita_config
  for update using (true) with check (true);

grant select, insert, update on public.orbita_config to anon, authenticated;
