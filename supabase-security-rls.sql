-- =============================================================================
-- Seguridad tipo “producción”: Supabase Auth + RLS
-- =============================================================================
-- ORDEN:
-- 1) Supabase Dashboard → Authentication → Providers → habilitar Email
-- 2) Authentication → Users → Add user → email + contraseña FUERTE (la guardás en un gestor, no en el código)
-- 3) Subí el sitio nuevo (orbita-auth.js + HTML actualizado)
-- 4) Ejecutá este script en SQL Editor (revisá errores si falta alguna tabla)
--
-- La clave "anon" puede seguir en el front: lo que importa es que RLS limite qué puede hacer anon vs authenticated.
-- NUNCA subas la "service_role" key al navegador ni a GitHub.
-- =============================================================================

-- ─── orbita_config: solo staff logueado ─────────────────────────────────────
DROP POLICY IF EXISTS "orbita_config_select" ON public.orbita_config;
DROP POLICY IF EXISTS "orbita_config_insert" ON public.orbita_config;
DROP POLICY IF EXISTS "orbita_config_update" ON public.orbita_config;

REVOKE ALL ON public.orbita_config FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.orbita_config TO authenticated;

CREATE POLICY "orbita_cfg_auth_select" ON public.orbita_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "orbita_cfg_auth_insert" ON public.orbita_config
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "orbita_cfg_auth_update" ON public.orbita_config
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ─── pedidos (Hand Roll): clientes insertan sin cuenta; lectura solo staff ─
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedidos_anon_insert" ON public.pedidos;
DROP POLICY IF EXISTS "pedidos_auth_select" ON public.pedidos;

CREATE POLICY "pedidos_anon_insert" ON public.pedidos
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "pedidos_auth_select" ON public.pedidos
  FOR SELECT TO authenticated USING (true);

-- ─── pedidos_cafe (si existe) ──────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pedidos_cafe') THEN
    EXECUTE 'ALTER TABLE public.pedidos_cafe ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "pedidos_cafe_anon_insert" ON public.pedidos_cafe';
    EXECUTE 'DROP POLICY IF EXISTS "pedidos_cafe_auth_select" ON public.pedidos_cafe';
    EXECUTE 'CREATE POLICY "pedidos_cafe_anon_insert" ON public.pedidos_cafe FOR INSERT TO anon WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "pedidos_cafe_auth_select" ON public.pedidos_cafe FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- ─── pedidos_fuente (si existe) ────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pedidos_fuente') THEN
    EXECUTE 'ALTER TABLE public.pedidos_fuente ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "pedidos_fuente_anon_insert" ON public.pedidos_fuente';
    EXECUTE 'DROP POLICY IF EXISTS "pedidos_fuente_auth_select" ON public.pedidos_fuente';
    EXECUTE 'CREATE POLICY "pedidos_fuente_anon_insert" ON public.pedidos_fuente FOR INSERT TO anon WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "pedidos_fuente_auth_select" ON public.pedidos_fuente FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- ─── resenas: lectura pública; borrar solo logueados ─────────────────────────
ALTER TABLE public.resenas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "resenas_select_all" ON public.resenas;
DROP POLICY IF EXISTS "resenas_anon_insert" ON public.resenas;
DROP POLICY IF EXISTS "resenas_auth_delete" ON public.resenas;
DROP POLICY IF EXISTS "resenas_public_read" ON public.resenas;

-- Si tenías otras políticas en resenas, eliminálas desde Dashboard o agregá DROP aquí.

CREATE POLICY "resenas_public_read" ON public.resenas
  FOR SELECT USING (true);
CREATE POLICY "resenas_anon_insert" ON public.resenas
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "resenas_auth_delete" ON public.resenas
  FOR DELETE TO authenticated USING (true);

GRANT SELECT ON public.resenas TO anon, authenticated;
GRANT INSERT ON public.resenas TO anon;
GRANT DELETE ON public.resenas TO authenticated;

-- ─── Permisos pedidos ────────────────────────────────────────────────────────
GRANT SELECT ON public.pedidos TO authenticated;
GRANT INSERT ON public.pedidos TO anon;

-- Nota: si algún INSERT/SELECT falla después de esto, revisá en Table Editor → políticas RLS
-- que no queden reglas viejas contradictorias (por ejemplo anon SELECT en pedidos).
