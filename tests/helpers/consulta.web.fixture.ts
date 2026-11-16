import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const MIGRACION_WEB = 'supabase/migrations/20261116063202_hu011_consultas_web.sql';
export async function baseConsultaWeb() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;`);
  await db.exec(readFileSync('tests/fixtures/esquema-base.sql','utf8'));
  for (const name of ['202610030001_hu026_ubicaciones.sql','202610070001_hu007_permisos_rol.sql',
    '202610090001_hu014_registro_lead_manual.sql','202610100001_hu014_modelo_publicado.sql',
    '202610220001_hu015_asignacion_leads.sql']) await db.exec(readFileSync(`supabase/migrations/${name}`,'utf8'));
  await db.exec(`TRUNCATE sede,ubicacion RESTART IDENTITY CASCADE;
    INSERT INTO auth.users VALUES
    ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
    INSERT INTO rol(nomrol) VALUES ('Gerente'),('Administradora'),('Vendedor');
    INSERT INTO usuario(uuidusu,codrol,nomusu,apepatusu,corusu)
      SELECT id,row_number() OVER(ORDER BY id),'PRUEBA QA CODEX','Sintético',id::text||'@example.test' FROM auth.users;
    INSERT INTO tipomotocar(nomtmo) VALUES ('EPSA-TEST');
    INSERT INTO modelo(codtmo,nommod,desmod,carmod,estmod) VALUES
      (1,'EPSA-TEST PUBLICADO','PRUEBA QA CODEX','PRUEBA QA CODEX','Publicado'),
      (1,'EPSA-TEST BORRADOR','PRUEBA QA CODEX','PRUEBA QA CODEX','Borrador');
    INSERT INTO ubicacion(nomubi,tipubi) VALUES ('Comas','Sede'),('Puente Piedra','Sede'),('Ventanilla','Sede'),('Ancón','Almacen'),('EPSA-TEST fibrera','Proveedor');
    INSERT INTO sede(codubi) SELECT codubi FROM ubicacion;
    CREATE FUNCTION public.web_registrar_interesado(text,text,bigint,text,bigint,text,text) RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
    GRANT EXECUTE ON FUNCTION public.web_registrar_interesado(text,text,bigint,text,bigint,text,text) TO anon;`);
  await db.exec(readFileSync(MIGRACION_WEB,'utf8'));
  return db;
}
