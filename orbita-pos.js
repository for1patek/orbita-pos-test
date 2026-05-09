-- =============================================================================
-- SCHEMA · Órbita POS — v2
-- Idempotente: se puede correr sobre una BD existente sin romper datos.
-- Orden: tablas → constraints → índices → RLS → grants → seeds
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- TABLA: orbita_config
-- Costos fijos y configuración general por local
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.orbita_config (
  clave      text        PRIMARY KEY,
  valor      bigint      NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.orbita_config (clave, valor) VALUES
  ('costo_fijo_handroll', 0),
  ('costo_fijo_cafe',     0),
  ('costo_fijo_fuente',   0)
ON CONFLICT (clave) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- TABLA: orbita_productos
-- Catálogo de productos por sitio (JSON)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.orbita_productos (
  sitio          text        PRIMARY KEY CHECK (sitio IN ('handroll','cafe','fuente')),
  productos_json jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.orbita_productos (sitio, productos_json) VALUES
  ('handroll', '[]'::jsonb),
  ('cafe',     '[]'::jsonb),
  ('fuente',   '{}'::jsonb)
ON CONFLICT (sitio) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- TABLA: orbita_clientes
-- Clientes registrados con método de pago guardado
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.orbita_clientes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text        UNIQUE NOT NULL,
  nombre            text        NOT NULL,
  metodo_pago       text        NOT NULL DEFAULT 'mercadopago',
  pin_hash          text        NOT NULL,
  telefono          text,
  direccion_entrega text,
  ultimos4          text,
  marca_tarjeta     text,
  titular_tarjeta   text,
  tipo_tarjeta      text,
  emisor_tarjeta    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orbita_clientes
  DROP CONSTRAINT IF EXISTS orbita_clientes_ultimos4_check;
ALTER TABLE public.orbita_clientes
  ADD CONSTRAINT orbita_clientes_ultimos4_check
  CHECK (ultimos4 IS NULL OR ultimos4 ~ '^[0-9]{4}$');

ALTER TABLE public.orbita_clientes
  DROP CONSTRAINT IF EXISTS orbita_clientes_tipo_check;
ALTER TABLE public.orbita_clientes
  ADD CONSTRAINT orbita_clientes_tipo_check
  CHECK (tipo_tarjeta IS NULL OR tipo_tarjeta IN ('credito','debito','prepago'));


-- ══════════════════════════════════════════════════════════════════════════════
-- TABLA: pos_usuarios
-- Personal que opera el POS. Login por PIN hasheado (SHA-256).
--
-- rol:   'cajero' | 'admin'
-- sitio: 'handroll' | 'cafe' | 'fuente' | 'ambos'
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pos_usuarios (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text        NOT NULL,
  rol        text        NOT NULL DEFAULT 'cajero',
  sitio      text        NOT NULL DEFAULT 'ambos',
  pin_hash   text        NOT NULL,
  activo     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_usuarios
  DROP CONSTRAINT IF EXISTS pos_usuarios_rol_check;
ALTER TABLE public.pos_usuarios
  ADD CONSTRAINT pos_usuarios_rol_check
  CHECK (rol IN ('cajero','admin'));

ALTER TABLE public.pos_usuarios
  DROP CONSTRAINT IF EXISTS pos_usuarios_sitio_check;
ALTER TABLE public.pos_usuarios
  ADD CONSTRAINT pos_usuarios_sitio_check
  CHECK (sitio IN ('handroll','cafe','fuente','ambos'));


-- ══════════════════════════════════════════════════════════════════════════════
-- TABLA: pedidos
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pedidos (
  id                    bigserial   PRIMARY KEY,
  creado_at             timestamptz NOT NULL DEFAULT now(),

  -- Datos del cliente
  nombre                text,
  telefono              text,
  direccion_entrega     text,

  -- Qué pidió
  sitio                 text        NOT NULL DEFAULT 'handroll',
  items_json            jsonb,
  salsas_texto          text,
  salsas                text,
  agridulce             smallint,
  pollo                 integer,
  camaron               integer,
  total                 integer,

  -- Logística
  tipo_entrega          text        NOT NULL DEFAULT 'retiro',
  hora_retiro           text,
  origen                text        NOT NULL DEFAULT 'web',

  -- Estado
  estado                text        NOT NULL DEFAULT 'pendiente',

  -- MercadoPago
  mp_payment_id         text,
  mp_preference_id      text,
  mp_external_reference text,

  -- Pago en puerta
  metodo_pago_entrega   text,

  -- Código de verificación de entrega (4 dígitos)
  codigo_entrega        char(4),

  -- Token Web Push del cliente
  push_subscription     jsonb
);

-- Columnas opcionales que pueden faltar en BDs existentes
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS origen              text    NOT NULL DEFAULT 'web';
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS codigo_entrega      char(4);
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS push_subscription   jsonb;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS metodo_pago_entrega text;

-- Unificar: renombrar 'direccion' → 'direccion_entrega' si existe la columna vieja
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pedidos' AND column_name = 'direccion'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pedidos' AND column_name = 'direccion_entrega'
  ) THEN
    ALTER TABLE public.pedidos RENAME COLUMN direccion TO direccion_entrega;
  END IF;
END $$;

-- Constraints de dominio
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_estado_check
  CHECK (estado IN (
    'pendiente','pagado','whatsapp',
    'en_cocina','listo','en_camino','recibido',
    'rechazado','anulado'
  ));

ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_sitio_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_sitio_check
  CHECK (sitio IN ('handroll','cafe','fuente'));

ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_tipo_entrega_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_tipo_entrega_check
  CHECK (tipo_entrega IN ('delivery','retiro','local'));

ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_origen_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_origen_check
  CHECK (origen IN ('web','whatsapp','fisico'));

ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_metodo_pago_entrega_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_metodo_pago_entrega_check
  CHECK (metodo_pago_entrega IS NULL OR metodo_pago_entrega IN ('efectivo','transferencia','online'));

ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_codigo_entrega_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_codigo_entrega_check
  CHECK (codigo_entrega IS NULL OR codigo_entrega ~ '^[0-9]{4}$');

-- Índices
CREATE INDEX IF NOT EXISTS pedidos_sitio_idx     ON public.pedidos(sitio);
CREATE INDEX IF NOT EXISTS pedidos_estado_idx    ON public.pedidos(estado);
CREATE INDEX IF NOT EXISTS pedidos_origen_idx    ON public.pedidos(origen);
CREATE INDEX IF NOT EXISTS pedidos_mp_ref_idx    ON public.pedidos(mp_external_reference);
CREATE INDEX IF NOT EXISTS pedidos_creado_at_idx ON public.pedidos(creado_at DESC);


-- ══════════════════════════════════════════════════════════════════════════════
-- TABLA: repartidor_location
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.repartidor_location (
  pedido_id  bigint           PRIMARY KEY REFERENCES public.pedidos(id) ON DELETE CASCADE,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  updated_at timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repartidor_location_updated_idx
  ON public.repartidor_location(updated_at DESC);


-- ══════════════════════════════════════════════════════════════════════════════
-- TABLA: resenas
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.resenas (
  id         bigserial   PRIMARY KEY,
  nombre     text        NOT NULL,
  estrellas  integer     NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
  comentario text        NOT NULL,
  creado_at  timestamptz DEFAULT now()
);


-- ══════════════════════════════════════════════════════════════════════════════
-- RLS — Row Level Security
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orbita_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbita_productos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbita_clientes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_usuarios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repartidor_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resenas             ENABLE ROW LEVEL SECURITY;

-- ── orbita_config ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cfg_auth_all"           ON public.orbita_config;
DROP POLICY IF EXISTS "orbita_config_select"   ON public.orbita_config;
DROP POLICY IF EXISTS "orbita_config_insert"   ON public.orbita_config;
DROP POLICY IF EXISTS "orbita_config_update"   ON public.orbita_config;
DROP POLICY IF EXISTS "orbita_cfg_auth_select" ON public.orbita_config;
DROP POLICY IF EXISTS "orbita_cfg_auth_insert" ON public.orbita_config;
DROP POLICY IF EXISTS "orbita_cfg_auth_update" ON public.orbita_config;
DROP POLICY IF EXISTS "cfg_select"             ON public.orbita_config;
DROP POLICY IF EXISTS "cfg_insert"             ON public.orbita_config;
DROP POLICY IF EXISTS "cfg_update"             ON public.orbita_config;

CREATE POLICY "cfg_select" ON public.orbita_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "cfg_insert" ON public.orbita_config
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cfg_update" ON public.orbita_config
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON public.orbita_config FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.orbita_config TO authenticated;

-- ── orbita_productos ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "productos_public_read" ON public.orbita_productos;
DROP POLICY IF EXISTS "productos_auth_write"  ON public.orbita_productos;
DROP POLICY IF EXISTS "productos_select"      ON public.orbita_productos;
DROP POLICY IF EXISTS "productos_write"       ON public.orbita_productos;

CREATE POLICY "productos_select" ON public.orbita_productos
  FOR SELECT USING (true);
CREATE POLICY "productos_write" ON public.orbita_productos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON public.orbita_productos TO anon;
GRANT ALL    ON public.orbita_productos TO authenticated;

-- ── orbita_clientes ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "clientes_auth_all" ON public.orbita_clientes;

CREATE POLICY "clientes_auth_all" ON public.orbita_clientes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.orbita_clientes TO authenticated;

-- ── pos_usuarios ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pos_usuarios_auth_all"   ON public.pos_usuarios;
DROP POLICY IF EXISTS "pos_usuarios_anon_select" ON public.pos_usuarios;

CREATE POLICY "pos_usuarios_auth_all" ON public.pos_usuarios
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "pos_usuarios_anon_select" ON public.pos_usuarios
  FOR SELECT TO anon USING (activo = true);

GRANT SELECT ON public.pos_usuarios TO anon;
GRANT ALL    ON public.pos_usuarios TO authenticated;

-- ── pedidos ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pedidos_anon_insert"      ON public.pedidos;
DROP POLICY IF EXISTS "pedidos_anon_select_own"  ON public.pedidos;
DROP POLICY IF EXISTS "pedidos_anon_push_update" ON public.pedidos;
DROP POLICY IF EXISTS "pedidos_auth_select"      ON public.pedidos;
DROP POLICY IF EXISTS "pedidos_auth_update"      ON public.pedidos;

CREATE POLICY "pedidos_anon_insert" ON public.pedidos
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "pedidos_anon_select_own" ON public.pedidos
  FOR SELECT TO anon USING (true);

CREATE POLICY "pedidos_anon_push_update" ON public.pedidos
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "pedidos_auth_select" ON public.pedidos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pedidos_auth_update" ON public.pedidos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT INSERT, SELECT ON public.pedidos TO anon;
GRANT UPDATE (push_subscription) ON public.pedidos TO anon;
GRANT SELECT, UPDATE ON public.pedidos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pedidos_id_seq TO anon;

-- ── repartidor_location ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "repart_anon_all" ON public.repartidor_location;
DROP POLICY IF EXISTS "repart_auth_all" ON public.repartidor_location;

CREATE POLICY "repart_anon_all" ON public.repartidor_location
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "repart_auth_all" ON public.repartidor_location
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.repartidor_location TO anon;
GRANT ALL                    ON public.repartidor_location TO authenticated;

-- ── resenas ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "resenas_public_read" ON public.resenas;
DROP POLICY IF EXISTS "resenas_anon_insert" ON public.resenas;
DROP POLICY IF EXISTS "resenas_auth_delete" ON public.resenas;
DROP POLICY IF EXISTS "resenas_select"      ON public.resenas;
DROP POLICY IF EXISTS "resenas_insert"      ON public.resenas;
DROP POLICY IF EXISTS "resenas_delete"      ON public.resenas;

CREATE POLICY "resenas_select" ON public.resenas
  FOR SELECT USING (true);
CREATE POLICY "resenas_insert" ON public.resenas
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "resenas_delete" ON public.resenas
  FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT ON public.resenas TO anon;
GRANT DELETE         ON public.resenas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.resenas_id_seq TO anon;


-- ══════════════════════════════════════════════════════════════════════════════
-- SEEDS — Catálogo de productos reales
-- ══════════════════════════════════════════════════════════════════════════════

-- HANDROLL
UPDATE public.orbita_productos
SET productos_json = '[
  {"id":"pollo","costo":0,"activo":true,"nombre":"Hand Roll Pollo","precio":3000,"categoria":"handroll"},
  {"id":"camaron","costo":0,"activo":true,"nombre":"Hand Roll Camarón","precio":3000,"categoria":"handroll"},
  {"id":"jugo_frambuesa","costo":0,"activo":true,"nombre":"Jugo Frambuesa","precio":3000,"categoria":"jugo"},
  {"id":"jugo_frutilla","costo":0,"activo":true,"nombre":"Jugo Frutilla","precio":2500,"categoria":"jugo"},
  {"id":"jugo_arandano","costo":0,"activo":true,"nombre":"Jugo Arándano","precio":2500,"categoria":"jugo"},
  {"id":"jugo_fru_ara","costo":0,"activo":true,"nombre":"Jugo Frutilla-Arándano","precio":2500,"categoria":"jugo"},
  {"id":"jugo_fram_ara","costo":0,"activo":true,"nombre":"Jugo Frambuesa-Arándano","precio":2500,"categoria":"jugo"},
  {"id":"jugo_melon_tuna","costo":0,"activo":true,"nombre":"Jugo Melón Tuna","precio":2500,"categoria":"jugo"},
  {"id":"jugo_melon_cal","costo":0,"activo":true,"nombre":"Jugo Melón Calameño","precio":2500,"categoria":"jugo"},
  {"id":"jugo_pina","costo":0,"activo":true,"nombre":"Jugo Piña","precio":2500,"categoria":"jugo"},
  {"id":"jugo_mango","costo":0,"activo":true,"nombre":"Jugo Mango","precio":2500,"categoria":"jugo"},
  {"id":"jugo_pina_mango","costo":0,"activo":true,"nombre":"Jugo Piña-Mango","precio":2500,"categoria":"jugo"},
  {"id":"jugo_naranja_plat","costo":0,"activo":true,"nombre":"Jugo Naranja-Plátano","precio":2500,"categoria":"jugo"},
  {"id":"beb_coca","costo":0,"activo":true,"nombre":"Coca-Cola","precio":2000,"categoria":"bebida"},
  {"id":"beb_coca_zero","costo":0,"activo":true,"nombre":"Coca-Cola sin azúcar","precio":2000,"categoria":"bebida"},
  {"id":"beb_pepsi","costo":0,"activo":true,"nombre":"Pepsi","precio":2000,"categoria":"bebida"},
  {"id":"beb_kem","costo":0,"activo":true,"nombre":"Kem","precio":2000,"categoria":"bebida"},
  {"id":"beb_bilz","costo":0,"activo":true,"nombre":"Bilz","precio":2000,"categoria":"bebida"},
  {"id":"beb_pap","costo":0,"activo":true,"nombre":"Pap","precio":2000,"categoria":"bebida"},
  {"id":"beb_fanta","costo":0,"activo":true,"nombre":"Fanta","precio":2000,"categoria":"bebida"},
  {"id":"beb_sprite","costo":0,"activo":true,"nombre":"Sprite","precio":2000,"categoria":"bebida"},
  {"id":"agua_gas","costo":0,"activo":true,"nombre":"Agua con gas","precio":1500,"categoria":"agua"},
  {"id":"agua_sin_gas","costo":0,"activo":true,"nombre":"Agua sin gas","precio":1500,"categoria":"agua"}
]'::jsonb
WHERE sitio = 'handroll';

-- CAFÉ
UPDATE public.orbita_productos
SET productos_json = '[
  {"id":"c_americano","cat":"cafe","desc":"Café Kimbo","grano":true,"activo":true,"nombre":"Americano","precio":0},
  {"id":"c_espresso","cat":"cafe","desc":"Café Kimbo","grano":true,"activo":true,"nombre":"Espresso","precio":0},
  {"id":"c_cortado","cat":"cafe","desc":"Café Kimbo","grano":true,"activo":true,"nombre":"Cortado","precio":0},
  {"id":"c_latte","cat":"cafe","desc":"Café Kimbo","grano":true,"activo":true,"nombre":"Latte","precio":0},
  {"id":"c_capuchino","cat":"cafe","desc":"Café Kimbo","grano":true,"activo":true,"nombre":"Capuchino","precio":0},
  {"id":"c_mocachino","cat":"cafe","desc":"Café Kimbo","grano":true,"activo":true,"nombre":"Mocachino","precio":0},
  {"id":"c_chocolate","cat":"cafe","desc":"Bebida caliente","grano":false,"activo":true,"nombre":"Chocolate Caliente","precio":0},
  {"id":"kuchen_migas","cat":"pasteleria","desc":"Frambuesa o arándano","grano":false,"activo":true,"nombre":"Kuchen de Migas","precio":0},
  {"id":"pie_limon","cat":"pasteleria","desc":"","grano":false,"activo":true,"nombre":"Pie de Limón","precio":0},
  {"id":"brownie","cat":"pasteleria","desc":"","grano":false,"activo":true,"nombre":"Brownie","precio":0},
  {"id":"cupcake","cat":"pasteleria","desc":"","grano":false,"activo":true,"nombre":"Cupcake","precio":0},
  {"id":"queque_zanahoria","cat":"pasteleria","desc":"Trozo","grano":false,"activo":true,"nombre":"Queque de Zanahoria","precio":0},
  {"id":"waffle","cat":"pasteleria","desc":"","grano":false,"activo":true,"nombre":"Waffle","precio":0},
  {"id":"jugo_frambuesa","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Frambuesa","precio":3000},
  {"id":"jugo_frutilla","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Frutilla","precio":2500},
  {"id":"jugo_arandano","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Arándano","precio":2500},
  {"id":"jugo_fru_ara","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Frutilla-Arándano","precio":2500},
  {"id":"jugo_fram_ara","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Frambuesa-Arándano","precio":2500},
  {"id":"jugo_melon_tuna","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Melón Tuna","precio":2500},
  {"id":"jugo_melon_cal","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Melón Calameño","precio":2500},
  {"id":"jugo_pina","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Piña","precio":2500},
  {"id":"jugo_mango","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Mango","precio":2500},
  {"id":"jugo_pina_mango","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Piña-Mango","precio":2500},
  {"id":"jugo_naranja_plat","cat":"jugo","desc":"","grano":false,"activo":true,"nombre":"Jugo Naranja-Plátano","precio":2500},
  {"id":"beb_coca","cat":"bebida","desc":"","grano":false,"activo":true,"nombre":"Coca-Cola","precio":2000},
  {"id":"beb_coca_zero","cat":"bebida","desc":"","grano":false,"activo":true,"nombre":"Coca-Cola sin azúcar","precio":2000},
  {"id":"beb_pepsi","cat":"bebida","desc":"","grano":false,"activo":true,"nombre":"Pepsi","precio":2000},
  {"id":"beb_kem","cat":"bebida","desc":"","grano":false,"activo":true,"nombre":"Kem","precio":2000},
  {"id":"beb_bilz","cat":"bebida","desc":"","grano":false,"activo":true,"nombre":"Bilz","precio":2000},
  {"id":"beb_pap","cat":"bebida","desc":"","grano":false,"activo":true,"nombre":"Pap","precio":2000},
  {"id":"beb_fanta","cat":"bebida","desc":"","grano":false,"activo":true,"nombre":"Fanta","precio":2000},
  {"id":"beb_sprite","cat":"bebida","desc":"","grano":false,"activo":true,"nombre":"Sprite","precio":2000},
  {"id":"agua_gas","cat":"agua","desc":"","grano":false,"activo":true,"nombre":"Agua con gas","precio":1500},
  {"id":"agua_sin_gas","cat":"agua","desc":"","grano":false,"activo":true,"nombre":"Agua sin gas","precio":1500}
]'::jsonb
WHERE sitio = 'cafe';

-- FUENTE DE SODA
UPDATE public.orbita_productos
SET productos_json = '{
  "bebidas": ["Coca-Cola","Coca-Cola sin azúcar","Pepsi","Kem","Bilz","Pap","Fanta","Sprite","Agua con gas","Agua sin gas"],
  "productos": [
    {"id":"salchipapa","cat":"extra","desc":"Papas + salchicha","costo":0,"activo":true,"bebida":false,"nombre":"Salchipapa","precio":0},
    {"id":"nuggets","cat":"extra","desc":"Papas + nuggets","costo":0,"activo":true,"bebida":false,"nombre":"Papas con Nuggets","precio":0},
    {"id":"mechada","cat":"sandwich","desc":"Mechada casera · papas · bebida","costo":0,"activo":true,"bebida":true,"nombre":"Sándwich Mechada","precio":0},
    {"id":"lomo","cat":"sandwich","desc":"Lomo ahumado · papas · bebida","costo":0,"activo":true,"bebida":true,"nombre":"Sándwich Lomo","precio":0},
    {"id":"hamburguesa","cat":"sandwich","desc":"Casera · papas · bebida","costo":0,"activo":true,"bebida":true,"nombre":"Hamburguesa","precio":0},
    {"id":"completo","cat":"completo","desc":"Solo","costo":0,"activo":true,"bebida":false,"nombre":"Completo","precio":0},
    {"id":"completo_promo","cat":"completo","desc":"Con papas + bebida","costo":0,"activo":true,"bebida":true,"nombre":"Completo Promo","precio":0},
    {"id":"completo_xl","cat":"completo","desc":"Italiano · papas + bebida","costo":0,"activo":true,"bebida":true,"nombre":"Completo XL","precio":0},
    {"id":"jugo_frambuesa","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Frambuesa","precio":3000},
    {"id":"jugo_frutilla","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Frutilla","precio":2500},
    {"id":"jugo_arandano","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Arándano","precio":2500},
    {"id":"jugo_fru_ara","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Frutilla-Arándano","precio":2500},
    {"id":"jugo_fram_ara","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Frambuesa-Arándano","precio":2500},
    {"id":"jugo_melon_tuna","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Melón Tuna","precio":2500},
    {"id":"jugo_melon_cal","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Melón Calameño","precio":2500},
    {"id":"jugo_pina","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Piña","precio":2500},
    {"id":"jugo_mango","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Mango","precio":2500},
    {"id":"jugo_pina_mango","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Piña-Mango","precio":2500},
    {"id":"jugo_naranja_plat","cat":"jugo","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Jugo Naranja-Plátano","precio":2500},
    {"id":"beb_coca","cat":"bebida","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Coca-Cola","precio":2000},
    {"id":"beb_coca_zero","cat":"bebida","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Coca-Cola sin azúcar","precio":2000},
    {"id":"beb_pepsi","cat":"bebida","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Pepsi","precio":2000},
    {"id":"beb_kem","cat":"bebida","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Kem","precio":2000},
    {"id":"beb_bilz","cat":"bebida","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Bilz","precio":2000},
    {"id":"beb_pap","cat":"bebida","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Pap","precio":2000},
    {"id":"beb_fanta","cat":"bebida","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Fanta","precio":2000},
    {"id":"beb_sprite","cat":"bebida","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Sprite","precio":2000},
    {"id":"agua_gas","cat":"agua","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Agua con gas","precio":1500},
    {"id":"agua_sin_gas","cat":"agua","desc":"","costo":0,"activo":true,"bebida":false,"nombre":"Agua sin gas","precio":1500}
  ],
  "ingredientes": [
    {"id":"tomate","activo":true,"nombre":"Tomate","precio":500},
    {"id":"palta","activo":true,"nombre":"Palta","precio":0},
    {"id":"mayo","activo":true,"nombre":"Mayonesa","precio":0},
    {"id":"chucrut","activo":true,"nombre":"Chucrut","precio":0},
    {"id":"americana","activo":true,"nombre":"Americana","precio":0},
    {"id":"lechuga","activo":true,"nombre":"Lechuga","precio":0},
    {"id":"cebolla","activo":true,"nombre":"Cebolla","precio":0},
    {"id":"queso","activo":true,"nombre":"Queso","precio":0},
    {"id":"pepino","activo":true,"nombre":"Pepinillos","precio":0},
    {"id":"porotos","activo":true,"nombre":"Porotos verdes","precio":0},
    {"id":"aji","activo":true,"nombre":"Ají","precio":0}
  ],
  "papas_tamanios": [
    {"id":"papa_chica","costo":0,"stock":0,"activo":true,"nombre":"Chica","precio":0},
    {"id":"papa_mediana","costo":0,"stock":0,"activo":true,"nombre":"Mediana","precio":0},
    {"id":"papa_grande","costo":0,"stock":0,"activo":true,"nombre":"Grande","precio":0}
  ]
}'::jsonb
WHERE sitio = 'fuente';


-- ══════════════════════════════════════════════════════════════════════════════
-- NOTAS PARA EL PROYECTO REAL
-- ══════════════════════════════════════════════════════════════════════════════
-- 1. pedidos_anon_select_own permite que cualquier anon lea cualquier pedido
--    conociendo su id. En producción agrega un token secreto por pedido y
--    valídalo en el WHERE para que solo el dueño pueda leerlo.
--
-- 2. repart_anon_all es amplia porque el repartidor llega sin login.
--    En producción genera un token único por pedido en la Edge Function
--    y valídalo antes de permitir el UPDATE de ubicación.
--
-- 3. push_subscription contiene el endpoint y las keys del dispositivo.
--    Nunca loguees su contenido completo en producción.
-- ══════════════════════════════════════════════════════════════════════════════
