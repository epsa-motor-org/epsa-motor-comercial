import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const MIGRACION_PEDIDO = '20261120030916_hu031_pedidos_sin_unidad.sql';
export const IDENTIDADES_PEDIDO = [1,2,3,4].map(n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`);
// Misma base de dependencias HU-005/HU-006 empleada por el retest HTTP real.
export const MIGRACIONES_PEDIDO = [
  ...Array.from(readFileSync('scripts/qa-hu006-postgrest.ts','utf8').matchAll(/'([0-9]{12,14}_[^']+\.sql)'/g), m => m[1]!)
    .filter(n => n !== 'supabase/migrations/20261117072549_hu006_errores_http_controlados.sql'),
  '202611150003_hu032_entrega_moto_vendida.sql','20261117072549_hu006_errores_http_controlados.sql',
  '202611190001_hu021_retorno_fisico.sql',MIGRACION_PEDIDO,'20261120031744_hu031_adelantos_y_continuidad.sql'
];
export const SQL_IDENTIDAD_PEDIDO = `CREATE SCHEMA auth; CREATE SCHEMA storage;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
      nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
  CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
  CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text NOT NULL,owner uuid,UNIQUE(bucket_id,name));
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
    $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
  GRANT SELECT,INSERT ON storage.objects TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`;
export const SQL_DATOS_PEDIDO = `INSERT INTO auth.users(id) VALUES ${IDENTIDADES_PEDIDO.map(x=>`('${x}')`).join(',')};
  INSERT INTO rol(nomrol) VALUES ('Gerente'),('Administradora'),('Vendedor');
  INSERT INTO usuario(uuidusu,codrol,nomusu,apepatusu,corusu) VALUES
    ('${IDENTIDADES_PEDIDO[0]}',1,'PRUEBA QA CODEX','Gerente','gerente@example.test'),
    ('${IDENTIDADES_PEDIDO[1]}',2,'PRUEBA QA CODEX','Admin','admin@example.test'),
    ('${IDENTIDADES_PEDIDO[2]}',3,'PRUEBA QA CODEX','Vendedor Uno','vendedor1@example.test'),
    ('${IDENTIDADES_PEDIDO[3]}',3,'PRUEBA QA CODEX','Vendedor Dos','vendedor2@example.test');
  INSERT INTO tipomotocar(nomtmo) VALUES ('EPSA-TEST');
  INSERT INTO modelo(codtmo,nommod,desmod,carmod,premod) VALUES (1,'EPSA-TEST','PRUEBA QA CODEX','PRUEBA QA CODEX',18335);
  INSERT INTO cliente(nomcli,apepatcli,telcli) VALUES ('PRUEBA QA CODEX','Comprador','987654323');
  INSERT INTO ubicacion(nomubi,tipubi) VALUES ('Comas EPSA-TEST','Sede');
  INSERT INTO sede(codubi) SELECT codubi FROM ubicacion WHERE nomubi='Comas EPSA-TEST';`;
export async function basePedido() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await db.exec(SQL_IDENTIDAD_PEDIDO);
  await db.exec(readFileSync('tests/fixtures/esquema-base.sql','utf8'));
  for (const n of MIGRACIONES_PEDIDO) await db.exec(readFileSync(`supabase/migrations/${n}`,'utf8'));
  await db.exec(SQL_DATOS_PEDIDO);
  return db;
}
