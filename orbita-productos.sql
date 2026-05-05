-- Catálogo de precios por sitio (Hand Roll, Café, Fuente). Ejecutar en Supabase SQL Editor.
-- Misma política que orbita_config: lectura pública, escritura según RLS.

create table if not exists public.orbita_productos (
  sitio text primary key check (sitio in ('handroll', 'cafe', 'fuente')),
  productos_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.orbita_productos (sitio, productos_json) values
  ('handroll', '[]'::jsonb),
  ('cafe', '[]'::jsonb),
  ('fuente', '{}'::jsonb)
on conflict (sitio) do nothing;

alter table public.orbita_productos enable row level security;

create policy "orbita_productos_select" on public.orbita_productos for select using (true);
create policy "orbita_productos_insert" on public.orbita_productos for insert with check (true);
create policy "orbita_productos_update" on public.orbita_productos for update using (true) with check (true);

grant select, insert, update on public.orbita_productos to anon, authenticated;
