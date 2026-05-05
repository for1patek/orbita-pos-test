-- =============================================================================
-- SCHEMA + POLICIES + SEEDS para proyecto demo Órbita Oasis
-- Se ejecuta UNA vez contra un Supabase vacío.
-- =============================================================================

-- ── TABLAS ──
CREATE TABLE IF NOT EXISTS public.orbita_config (
  clave text PRIMARY KEY,
  valor bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.orbita_config (clave, valor) VALUES
  ('costo_fijo_handroll', 0),
  ('costo_fijo_cafe', 0),
  ('costo_fijo_fuente', 0)
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.orbita_productos (
  sitio text PRIMARY KEY CHECK (sitio IN ('handroll','cafe','fuente')),
  productos_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.orbita_productos (sitio, productos_json) VALUES
  ('handroll', '[]'::jsonb),
  ('cafe', '[]'::jsonb),
  ('fuente', '{}'::jsonb)
ON CONFLICT (sitio) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.orbita_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  nombre text NOT NULL,
  metodo_pago text NOT NULL DEFAULT 'mercadopago',
  pin_hash text NOT NULL,
  telefono text,
  direccion_entrega text,
  ultimos4 text,
  marca_tarjeta text,
  titular_tarjeta text,
  tipo_tarjeta text,
  emisor_tarjeta text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orbita_clientes DROP CONSTRAINT IF EXISTS orbita_clientes_ultimos4_check;
ALTER TABLE public.orbita_clientes ADD CONSTRAINT orbita_clientes_ultimos4_check
  CHECK (ultimos4 IS NULL OR ultimos4 ~ '^[0-9]{4}$');
ALTER TABLE public.orbita_clientes DROP CONSTRAINT IF EXISTS orbita_clientes_tipo_check;
ALTER TABLE public.orbita_clientes ADD CONSTRAINT orbita_clientes_tipo_check
  CHECK (tipo_tarjeta IS NULL OR tipo_tarjeta IN ('credito','debito','prepago'));

CREATE TABLE IF NOT EXISTS public.pedidos (
  id bigserial PRIMARY KEY,
  creado_at timestamptz DEFAULT now(),
  nombre text,
  total integer,
  hora_retiro text,
  tipo_entrega text,
  items_json jsonb,
  salsas_texto text,
  direccion_entrega text,
  telefono text,
  sitio text NOT NULL DEFAULT 'handroll',
  estado text NOT NULL DEFAULT 'pendiente',
  mp_payment_id text,
  mp_preference_id text,
  mp_external_reference text,
  salsas text,
  agridulce smallint,
  pollo integer,
  camaron integer
);

ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_estado_check
  CHECK (estado IN ('pendiente','pagado','rechazado','anulado','whatsapp'));
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_sitio_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_sitio_check
  CHECK (sitio IN ('handroll','cafe','fuente'));

CREATE INDEX IF NOT EXISTS pedidos_sitio_idx ON public.pedidos(sitio);
CREATE INDEX IF NOT EXISTS pedidos_estado_idx ON public.pedidos(estado);
CREATE INDEX IF NOT EXISTS pedidos_mp_ref_idx ON public.pedidos(mp_external_reference);
CREATE INDEX IF NOT EXISTS pedidos_creado_at_idx ON public.pedidos(creado_at DESC);

CREATE TABLE IF NOT EXISTS public.resenas (
  id bigserial PRIMARY KEY,
  nombre text NOT NULL,
  estrellas integer NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
  comentario text NOT NULL,
  creado_at timestamptz DEFAULT now()
);

-- ── RLS ──
ALTER TABLE public.orbita_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbita_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbita_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resenas ENABLE ROW LEVEL SECURITY;

-- orbita_config: solo staff
DROP POLICY IF EXISTS "cfg_auth_all" ON public.orbita_config;
CREATE POLICY "cfg_auth_all" ON public.orbita_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- orbita_productos: lectura pública, escritura authenticated
DROP POLICY IF EXISTS "productos_public_read" ON public.orbita_productos;
CREATE POLICY "productos_public_read" ON public.orbita_productos
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "productos_auth_write" ON public.orbita_productos;
CREATE POLICY "productos_auth_write" ON public.orbita_productos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT ON public.orbita_productos TO anon;
GRANT ALL ON public.orbita_productos TO authenticated;

-- orbita_clientes: solo authenticated
DROP POLICY IF EXISTS "clientes_auth_all" ON public.orbita_clientes;
CREATE POLICY "clientes_auth_all" ON public.orbita_clientes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.orbita_clientes TO authenticated;

-- pedidos: INSERT anon, SELECT/UPDATE authenticated
DROP POLICY IF EXISTS "pedidos_anon_insert" ON public.pedidos;
CREATE POLICY "pedidos_anon_insert" ON public.pedidos
  FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "pedidos_auth_select" ON public.pedidos;
CREATE POLICY "pedidos_auth_select" ON public.pedidos
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "pedidos_auth_update" ON public.pedidos;
CREATE POLICY "pedidos_auth_update" ON public.pedidos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
GRANT INSERT ON public.pedidos TO anon;
GRANT SELECT, UPDATE ON public.pedidos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pedidos_id_seq TO anon;

-- resenas: lectura pública, insert anon, delete authenticated
DROP POLICY IF EXISTS "resenas_public_read" ON public.resenas;
CREATE POLICY "resenas_public_read" ON public.resenas
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "resenas_anon_insert" ON public.resenas;
CREATE POLICY "resenas_anon_insert" ON public.resenas
  FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "resenas_auth_delete" ON public.resenas;
CREATE POLICY "resenas_auth_delete" ON public.resenas
  FOR DELETE TO authenticated USING (true);
GRANT SELECT, INSERT ON public.resenas TO anon;
GRANT DELETE ON public.resenas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.resenas_id_seq TO anon;

-- ── SEEDS productos ──
UPDATE public.orbita_productos SET productos_json = '[
  {"id":"pollo","nombre":"Hand Roll Pollo","precio":3500,"categoria":"handroll","activo":true},
  {"id":"camaron","nombre":"Hand Roll Camarón","precio":4500,"categoria":"handroll","activo":true},
  {"id":"jugo_frutilla","nombre":"Jugo Frutilla","precio":1800,"categoria":"jugo","activo":true},
  {"id":"jugo_mango","nombre":"Jugo Mango","precio":1800,"categoria":"jugo","activo":true},
  {"id":"coca","nombre":"Coca-Cola 500ml","precio":1500,"categoria":"bebida","activo":true},
  {"id":"sprite","nombre":"Sprite 500ml","precio":1500,"categoria":"bebida","activo":true},
  {"id":"agua","nombre":"Agua mineral 500ml","precio":1200,"categoria":"agua","activo":true}
]'::jsonb WHERE sitio = 'handroll';

UPDATE public.orbita_productos SET productos_json = '[
  {"id":"espresso","nombre":"Espresso","precio":1800,"cat":"cafe","activo":true},
  {"id":"capuccino","nombre":"Capuccino","precio":2500,"cat":"cafe","activo":true},
  {"id":"latte","nombre":"Latte","precio":2800,"cat":"cafe","activo":true},
  {"id":"mocca","nombre":"Mocaccino","precio":3000,"cat":"cafe","activo":true},
  {"id":"torta_choco","nombre":"Torta Chocolate","precio":3200,"cat":"pasteleria","activo":true},
  {"id":"brownie","nombre":"Brownie","precio":2400,"cat":"pasteleria","activo":true}
]'::jsonb WHERE sitio = 'cafe';

UPDATE public.orbita_productos SET productos_json = '{
  "productos":[
    {"id":"completo_italiano","nombre":"Completo Italiano","precio":3200,"cat":"completo","activo":true},
    {"id":"completo_queso","nombre":"Completo Queso","precio":2800,"cat":"completo","activo":true},
    {"id":"churrasco","nombre":"Churrasco","precio":3800,"cat":"sandwich","activo":true},
    {"id":"chacarero","nombre":"Chacarero","precio":4200,"cat":"sandwich","activo":true}
  ],
  "papas_tamanios":[
    {"id":"ch","nombre":"Chica","precio":1500},
    {"id":"md","nombre":"Mediana","precio":2000},
    {"id":"gd","nombre":"Grande","precio":2500}
  ],
  "bebidas":["Coca-Cola","Sprite","Fanta","Bilz","Agua Mineral"],
  "ingredientes":[
    {"nombre":"Tocino","precio":500},
    {"nombre":"Palta","precio":700},
    {"nombre":"Huevo","precio":500},
    {"nombre":"Queso extra","precio":600}
  ]
}'::jsonb WHERE sitio = 'fuente';
