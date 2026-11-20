import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const SECRET = 'local-test-factura-importacion-hmac-secret-32-bytes';
const AUTHORIZED_SENDER = 'fespinozac2@gmail.com';
const AUTHENTICATED_DOMAIN = 'gmail.com';
const AUTHENTICATED_HEADERS = [
  'From: "Cuenta Crosland" <fespinozac2@gmail.com>',
  'Authentication-Results: mx.google.com; spf=pass smtp.mailfrom=fespinozac2@gmail.com;',
  '\tdkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com'
].join('\r\n');
const scripts = [
  'apps-script/importacion-facturas/FacturaImportacionCore.gs',
  'apps-script/importacion-facturas/FacturaImportacionPolling.gs',
  'apps-script/importacion-facturas/FacturaImportacionTriggers.gs'
].map((path) => readFileSync(path, 'utf8')).join('\n');

function asUnsigned(bytes: ArrayLike<number>) {
  return Buffer.from(Array.from(bytes, (byte) => (Number(byte) + 256) & 0xff));
}

function makeRuntime(options: {
  fetch?: (url: string, request: Record<string, unknown>) => unknown;
  search?: (query: string, start: number, max: number) => unknown[];
  messages?: Record<string, unknown>;
  lockResult?: boolean;
} = {}) {
  const scriptValues = new Map<string, string>();
  const calls: Array<{ url: string; request: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const labels = new Map<string, { getName(): string }>();
  const createdTriggers: Array<{ handler: string }> = [];
  const triggers: Array<{ handler: string; getHandlerFunction(): string; getEventType(): string; getTriggerSource(): string }> = [];
  let lockReleased = false;
  let searchCount = 0;
  let uuidCounter = 0;

  const properties = (map: Map<string, string>) => ({
    getProperty: (key: string) => map.get(key) ?? null,
    setProperty: (key: string, value: string) => { map.set(key, value); },
    deleteProperty: (key: string) => { map.delete(key); }
  });
  const signed = (bytes: Buffer) => Array.from(bytes, (byte) => byte > 127 ? byte - 256 : byte);
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (_algorithm: string, bytes: ArrayLike<number>) => signed(createHash('sha256').update(asUnsigned(bytes)).digest()),
    computeHmacSha256Signature: (canonical: string, secret: string) => signed(createHmac('sha256', secret).update(canonical, 'utf8').digest()),
    getUuid: () => `a0000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
    formatDate: (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '/')
  };
  const GmailApp = {
    search: (query: string, start: number, max: number) => {
      searchCount += 1;
      return options.search ? options.search(query, start, max) : [];
    },
    getMessageById: (id: string) => (options.messages ?? {})[id] ?? null,
    getUserLabelByName: (name: string) => labels.get(name) ?? null,
    createLabel: (name: string) => {
      const label = { getName: () => name };
      labels.set(name, label);
      return label;
    }
  };
  const UrlFetchApp = {
    fetch: (url: string, request: Record<string, unknown>) => {
      calls.push({ url, request });
      return options.fetch ? options.fetch(url, request) : response(201, { ok: true, data: { codrec: '90000000-0000-4000-8000-000000000001', coddoc: '81', pdfPendiente: false } });
    }
  };
  const ScriptApp = {
    getProjectTriggers: () => triggers,
    deleteTrigger: (trigger: unknown) => { const index = triggers.indexOf(trigger as typeof triggers[number]); if (index >= 0) triggers.splice(index, 1); },
    newTrigger: (handler: string) => ({
      timeBased: () => ({ everyMinutes: (minutes: number) => ({ create: () => {
        assert.equal(minutes, 5);
        createdTriggers.push({ handler });
        const trigger = { handler, getHandlerFunction: () => handler, getEventType: () => 'CLOCK', getTriggerSource: () => 'TIME' };
        triggers.push(trigger);
        return trigger;
      } }) })
    })
  };
  const context = createContext({
    Utilities,
    PropertiesService: {
      getScriptProperties: () => properties(scriptValues)
    },
    GmailApp,
    UrlFetchApp,
    LockService: { getScriptLock: () => ({
      tryLock: () => options.lockResult ?? true,
      releaseLock: () => { lockReleased = true; }
    }) },
    ScriptApp,
    Logger: { log: (entry: string) => logs.push(String(entry)) }
  }) as Record<string, any>;
  runInContext(scripts, context);
  return {
    context, scriptValues, calls, logs, labels, createdTriggers, triggers,
    get lockReleased() { return lockReleased; },
    get searchCount() { return searchCount; }
  };
}

function response(status: number, body: Record<string, unknown>) {
  return { getResponseCode: () => status, getContentText: () => JSON.stringify(body) };
}

function blob(bytes: number[] | Buffer, name: string, mime: string) {
  const data = Array.from(bytes, (byte) => Number(byte) > 127 ? Number(byte) - 256 : Number(byte));
  return {
    getBytes: () => data.slice(),
    getName: () => name,
    getContentType: () => mime,
    setContentType: (contentType: string) => blob(data, name, contentType)
  };
}

function configure(runtime: ReturnType<typeof makeRuntime>) {
  runtime.scriptValues.set('HU030_ENDPOINT_URL', 'https://example.invalid/api/integraciones/facturas');
  runtime.scriptValues.set('HU030_HMAC_KEY_ID', 'local-test-key');
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', '2026-10-01T00:00:00Z');
  runtime.scriptValues.set('HU030_HMAC_SECRET', SECRET);
  runtime.scriptValues.set('HU030_REMITENTES_AUTORIZADOS', AUTHORIZED_SENDER);
  runtime.scriptValues.set('HU030_DOMINIOS_AUTENTICACION', AUTHENTICATED_DOMAIN);
}

function clientConfig() {
  return {
    endpoint: 'https://example.invalid/api/integraciones/facturas',
    keyId: 'local-test-key',
    secret: SECRET,
    remitentesAutorizados: [AUTHORIZED_SENDER],
    dominiosAutenticacion: [AUTHENTICATED_DOMAIN],
    labels: {
      Procesado: 'EPSA/HU030/Procesado', Pendiente: 'EPSA/HU030/Pendiente',
      Revision: 'EPSA/HU030/Revision', Error: 'EPSA/HU030/Error'
    }
  };
}

function thread(id: string, messages: any[], initialLabels: string[] = []) {
  const attached: string[] = [];
  const removed: string[] = [];
  const currentLabels = new Set(initialLabels);
  return {
    getId: () => id,
    getMessages: () => messages,
    getLabels: () => Array.from(currentLabels, (name) => ({ getName: () => name })),
    addLabel: (label: { getName(): string }) => { attached.push(label.getName()); currentLabels.add(label.getName()); },
    removeLabel: (label: { getName(): string }) => { removed.push(label.getName()); currentLabels.delete(label.getName()); },
    refresh: () => undefined,
    attached,
    removed,
    get currentLabels() { return Array.from(currentLabels); }
  };
}

function message(id: string, date: Date, attachments: unknown[], parentThread?: unknown, rawHeaders = AUTHENTICATED_HEADERS) {
  let attachmentReads = 0;
  let rawReads = 0;
  const fromHeader = rawHeaders.split(/\r?\n/).find((line) => /^from:/i.test(line))?.replace(/^from:/i, '').trim() ?? '';
  return {
    getId: () => id,
    getDate: () => date,
    getThread: () => parentThread,
    getFrom: () => fromHeader,
    getRawContent: () => { rawReads += 1; return `${rawHeaders}\r\n\r\n`; },
    getAttachments: (options: Record<string, boolean>) => {
      attachmentReads += 1;
      assert.equal(options.includeInlineImages, false);
      assert.equal(options.includeAttachments, true);
      return attachments;
    },
    get attachmentReadCount() { return attachmentReads; },
    get rawReadCount() { return rawReads; }
  };
}

function authenticationHeaders(options: {
  from?: string; authserv?: string; spf?: string; mailfrom?: string;
  dkim?: string; dkimDomain?: string; dmarc?: string; fromDomain?: string;
} = {}) {
  const from = options.from ?? AUTHORIZED_SENDER;
  const authserv = options.authserv ?? 'mx.google.com';
  const spf = options.spf ?? 'pass';
  const mailfrom = options.mailfrom ?? AUTHORIZED_SENDER;
  const dkim = options.dkim ?? 'pass';
  const dkimDomain = options.dkimDomain ?? '@gmail.com';
  const dmarc = options.dmarc ?? 'pass';
  const fromDomain = options.fromDomain ?? 'gmail.com';
  return [
    `From: "Cuenta de facturación" <${from}>`,
    `Authentication-Results: ${authserv}; spf=${spf} smtp.mailfrom=${mailfrom};`,
    `\tdkim=${dkim} header.i=${dkimDomain}; dmarc=${dmarc} header.from=${fromDomain}`
  ].join('\r\n');
}

test('HU-030 Apps Script: SHA-256 conserva bytes signed y devuelve hex lowercase', () => {
  const runtime = makeRuntime();
  assert.equal(runtime.context.bytesFirmadosAHex([-1, 0, 127, -128]), 'ff007f80');
  const bytes = [0, 255, 60, 62, 10];
  assert.equal(runtime.context.sha256Hex(bytes), createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
});

test('HU-030 Apps Script: configuración incompleta falla cerrada y valida endpoint, lote y labels', () => {
  const runtime = makeRuntime();
  assert.throws(() => runtime.context.facturaImportacionLeerConfiguracion(), /CONFIGURACION_INCOMPLETA/);
  configure(runtime);
  const config = runtime.context.facturaImportacionLeerConfiguracion();
  assert.equal(config.batchMax, 25);
  assert.equal(config.secret, SECRET);
  assert.deepEqual(Array.from(config.remitentesAutorizados), [AUTHORIZED_SENDER]);
  assert.deepEqual(Array.from(config.dominiosAutenticacion), [AUTHENTICATED_DOMAIN]);
  runtime.scriptValues.delete('HU030_REMITENTES_AUTORIZADOS');
  assert.throws(() => runtime.context.facturaImportacionLeerConfiguracion(), /CONFIGURACION_AUTENTICACION_INCOMPLETA/);
  runtime.scriptValues.set('HU030_REMITENTES_AUTORIZADOS', 'flavio <fespinozac2@gmail.com>');
  assert.throws(() => runtime.context.facturaImportacionLeerConfiguracion(), /CONFIGURACION_AUTENTICACION_INCOMPLETA/);
  runtime.scriptValues.set('HU030_REMITENTES_AUTORIZADOS', AUTHORIZED_SENDER);
  runtime.scriptValues.set('HU030_DOMINIOS_AUTENTICACION', 'example.com');
  assert.throws(() => runtime.context.facturaImportacionLeerConfiguracion(), /CONFIGURACION_AUTENTICACION_INCOMPLETA/);
  runtime.scriptValues.set('HU030_DOMINIOS_AUTENTICACION', AUTHENTICATED_DOMAIN);
  runtime.scriptValues.set('HU030_LOTE_MAX', '101');
  assert.throws(() => runtime.context.facturaImportacionLeerConfiguracion(), /CONFIGURACION_LOTE_INVALIDA/);
  runtime.scriptValues.set('HU030_LOTE_MAX', '25');
  runtime.scriptValues.set('HU030_LABEL_ERROR', 'EPSA/HU030/Procesado');
  assert.throws(() => runtime.context.facturaImportacionLeerConfiguracion(), /CONFIGURACION_LABEL_DUPLICADA/);
});

test('HU-030 EMT-141: remitente autorizado y autenticación Gmail válida habilitan el flujo', () => {
  const now = Date.now();
  const parent = thread('auth-positive-thread', []);
  const xml = blob([60, 120, 109, 108, 62], 'invoice.xml', 'application/xml');
  const email = message('auth-positive-message', new Date(now - 1000), [xml], parent);
  parent.getMessages = () => [email];
  const runtime = makeRuntime({ search: () => [parent] });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', new Date(now - 60_000).toISOString());
  runtime.context.procesarCorreosPendientes();
  assert.equal(runtime.calls.length, 1);
  assert.equal(email.attachmentReadCount, 1);
  const event = runtime.logs.map((line) => JSON.parse(line)).find((entry) => entry.evento === 'AUTENTICACION_CORREO');
  assert.equal(event.estadoAutenticacion, 'AUTORIZADO');
  assert.equal(event.code, 'ORIGEN_AUTENTICADO');
  assert.equal(JSON.stringify(event).includes('Authentication-Results'), false);
});

test('HU-030 EMT-141: remitente ajeno aunque parezca legítimo queda excluido antes de leer adjuntos', () => {
  const now = Date.now();
  const parent = thread('auth-foreign-thread', []);
  const email = message('auth-foreign-message', new Date(now - 1000), [blob([60], 'invoice.xml', 'application/xml')], parent,
    authenticationHeaders({ from: 'otro@gmail.com' }));
  parent.getMessages = () => [email];
  const runtime = makeRuntime({ search: () => [parent] });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', new Date(now - 60_000).toISOString());
  runtime.context.procesarCorreosPendientes();
  assert.equal(runtime.calls.length, 0);
  assert.equal(email.attachmentReadCount, 0);
  assert.equal(email.rawReadCount, 0);
  assert.deepEqual(parent.currentLabels, []);
  const event = runtime.logs.map((line) => JSON.parse(line)).find((entry) => entry.messageId === 'auth-foreign-message');
  assert.equal(event.estadoAutenticacion, 'EXCLUIDO');
  assert.equal(event.code, 'REMITENTE_NO_AUTORIZADO');
});

test('HU-030 EMT-141: From correcto con autenticación fallida va a revisión sin adjuntos ni backend', () => {
  const now = Date.now();
  const parent = thread('auth-invalid-thread', []);
  const email = message('auth-invalid-message', new Date(now - 1000), [blob([60], 'invoice.xml', 'application/xml')], parent,
    authenticationHeaders({ spf: 'fail' }));
  parent.getMessages = () => [email];
  const runtime = makeRuntime({ search: () => [parent] });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', new Date(now - 60_000).toISOString());
  runtime.context.procesarCorreosPendientes();
  assert.equal(runtime.calls.length, 0);
  assert.equal(email.attachmentReadCount, 0);
  assert.deepEqual(parent.currentLabels, ['EPSA/HU030/Revision']);
  const event = runtime.logs.map((line) => JSON.parse(line)).find((entry) => entry.messageId === 'auth-invalid-message');
  assert.equal(event.estadoAutenticacion, 'REVISION');
  assert.equal(event.code, 'SPF_INVALIDO');
});

test('HU-030 EMT-141: thread mixto valida cada mensaje y solo procesa el remitente autenticado', () => {
  const now = Date.now();
  const parent = thread('auth-mixed-thread', []);
  const valid = message('auth-mixed-valid', new Date(now - 3000), [blob([60, 1], 'allowed.xml', 'application/xml')], parent);
  const foreign = message('auth-mixed-foreign', new Date(now - 2000), [blob([60, 2], 'foreign.xml', 'application/xml')], parent,
    authenticationHeaders({ from: 'otro@gmail.com' }));
  parent.getMessages = () => [valid, foreign];
  const runtime = makeRuntime({ search: () => [parent] });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', new Date(now - 60_000).toISOString());
  runtime.context.procesarCorreosPendientes();
  assert.equal(runtime.calls.length, 1);
  assert.equal((runtime.calls[0]?.request.headers as Record<string, string>)['X-EPSA-Message-Id'], 'auth-mixed-valid');
  assert.equal(valid.attachmentReadCount, 1);
  assert.equal(foreign.attachmentReadCount, 0);
  const events = runtime.logs.map((line) => JSON.parse(line)).filter((entry) => entry.evento === 'AUTENTICACION_CORREO');
  assert.deepEqual(events.map((entry) => [entry.messageId, entry.estadoAutenticacion]), [
    ['auth-mixed-valid', 'AUTORIZADO'], ['auth-mixed-foreign', 'EXCLUIDO']
  ]);
});

test('HU-030 EMT-141: mensaje autorizado solo con PDF queda en revisión sin llamar backend', () => {
  const now = Date.now();
  const parent = thread('auth-pdf-only-thread', []);
  const email = message('auth-pdf-only-message', new Date(now - 1000), [blob([37, 80, 68, 70, 45], 'invoice.pdf', 'application/pdf')], parent);
  parent.getMessages = () => [email];
  const runtime = makeRuntime({ search: () => [parent] });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', new Date(now - 60_000).toISOString());
  runtime.context.procesarCorreosPendientes();
  assert.equal(email.attachmentReadCount, 1);
  assert.equal(runtime.calls.length, 0);
  assert.deepEqual(parent.currentLabels, ['EPSA/HU030/Revision']);
});

test('HU-030 EMT-141: XML inválido autenticado se envía al validador y queda en revisión ante 422', () => {
  const now = Date.now();
  const parent = thread('auth-invalid-xml-thread', []);
  const email = message('auth-invalid-xml-message', new Date(now - 1000), [blob([60, 120, 109, 108, 62], 'invalid.xml', 'application/xml')], parent);
  parent.getMessages = () => [email];
  const runtime = makeRuntime({ search: () => [parent], fetch: () => response(422, { ok: false, code: 'VALIDACION_DOCUMENTAL_FALLIDA' }) });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', new Date(now - 60_000).toISOString());
  runtime.context.procesarCorreosPendientes();
  assert.equal(email.attachmentReadCount, 1);
  assert.equal(runtime.calls.length, 1);
  assert.deepEqual(parent.currentLabels, ['EPSA/HU030/Revision']);
});

test('HU-030 EMT-141: configuración de remitentes incompleta detiene la corrida antes de buscar Gmail', () => {
  const runtime = makeRuntime({ search: () => { assert.fail('Gmail no debe consultarse con configuración incompleta'); return []; } });
  configure(runtime);
  runtime.scriptValues.delete('HU030_DOMINIOS_AUTENTICACION');
  runtime.context.procesarCorreosPendientes();
  assert.equal(runtime.searchCount, 0);
  assert.equal(runtime.calls.length, 0);
  assert.equal(runtime.lockReleased, true);
  const event = runtime.logs.map((line) => JSON.parse(line)).find((entry) => entry.evento === 'CONFIGURACION_AUTENTICACION_INCOMPLETA');
  assert.ok(event);
});

test('HU-030 EMT-141: retry vuelve a validar origen y no reenvía cuando la autenticación ya no es válida', () => {
  const now = Date.now();
  const parent = thread('auth-retry-thread', []);
  const email = message('auth-retry-message', new Date(now - 1000), [blob([60, 120, 109, 108], 'retry.xml', 'application/xml')], parent);
  let rawHeaders = AUTHENTICATED_HEADERS;
  email.getRawContent = () => `${rawHeaders}\r\n\r\n`;
  parent.getMessages = () => [email];
  let fetchCount = 0;
  const runtime = makeRuntime({ search: () => [parent], fetch: () => {
    fetchCount += 1;
    return response(503, { ok: false });
  } });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', new Date(now - 60_000).toISOString());
  runtime.context.procesarCorreosPendientes();
  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.scriptValues.has('HU030_RETRY_QUEUE_JSON'), true);
  const queued = JSON.parse(runtime.scriptValues.get('HU030_RETRY_QUEUE_JSON')!)[0];
  queued.nextAttemptAt = new Date(Date.now() - 1000).toISOString();
  runtime.scriptValues.set('HU030_RETRY_QUEUE_JSON', JSON.stringify([queued]));
  rawHeaders = authenticationHeaders({ dkim: 'fail' });
  runtime.context.procesarCorreosPendientes();
  assert.equal(fetchCount, 1);
  assert.equal(email.attachmentReadCount, 1);
  assert.equal(runtime.scriptValues.has('HU030_RETRY_QUEUE_JSON'), false);
  assert.deepEqual(parent.currentLabels, ['EPSA/HU030/Revision']);
});

test('HU-030 EMT-141: lote mixto ignora mensajes irrelevantes y procesa el único mensaje legítimo', () => {
  const now = Date.now();
  const parent = thread('auth-batch-thread', []);
  const irrelevant = message('auth-batch-foreign', new Date(now - 3000), [blob([1], 'nota.txt', 'text/plain')], parent,
    authenticationHeaders({ from: 'ventas@gmail.com' }));
  const valid = message('auth-batch-valid', new Date(now - 2000), [blob([60, 120], 'invoice.xml', 'application/xml')], parent);
  parent.getMessages = () => [irrelevant, valid];
  const runtime = makeRuntime({ search: () => [parent] });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', new Date(now - 60_000).toISOString());
  runtime.context.procesarCorreosPendientes();
  assert.equal(runtime.calls.length, 1);
  assert.equal((runtime.calls[0]?.request.headers as Record<string, string>)['X-EPSA-Message-Id'], 'auth-batch-valid');
  assert.equal(irrelevant.attachmentReadCount, 0);
  assert.equal(valid.attachmentReadCount, 1);
});

test('HU-030 EMT-141: parser trata cabeceras plegadas, duplicadas y falsificadas de forma cerrada', () => {
  const runtime = makeRuntime();
  const config = clientConfig();
  const folded = runtime.context.facturaImportacionAutenticarCabeceras(`${AUTHENTICATED_HEADERS}\r\n\r\nbody`, config);
  assert.equal(folded.autorizado, true);

  const fakeOnly = runtime.context.facturaImportacionAutenticarCabeceras(
    authenticationHeaders({ authserv: 'attacker.example' }), config);
  assert.equal(fakeOnly.autorizado, false);
  assert.equal(fakeOnly.motivo, 'AUTHENTICATION_RESULTS_NO_CONFIABLE');

  const multiple = runtime.context.facturaImportacionAutenticarCabeceras(
    `${AUTHENTICATED_HEADERS}\r\nAuthentication-Results: attacker.example; spf=pass smtp.mailfrom=${AUTHORIZED_SENDER};\r\n\r\nbody`, config);
  assert.equal(multiple.autorizado, false);
  assert.equal(multiple.motivo, 'AUTHENTICATION_RESULTS_AMBIGUO');

  const forgedBeforeGoogle = runtime.context.facturaImportacionAutenticarCabeceras(
    `From: ${AUTHORIZED_SENDER}\r\nAuthentication-Results: attacker.example; spf=pass smtp.mailfrom=${AUTHORIZED_SENDER};\r\nAuthentication-Results: mx.google.com; spf=pass smtp.mailfrom=${AUTHORIZED_SENDER}; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com`, config);
  assert.equal(forgedBeforeGoogle.motivo, 'AUTHENTICATION_RESULTS_AMBIGUO');
});

test('HU-030 EMT-141: parser normaliza espacios/mayúsculas y exige SPF, DKIM y DMARC', () => {
  const runtime = makeRuntime();
  const config = clientConfig();
  const upper = [
    'fRoM:  <FESPINOZAC2@GMAIL.COM>  ',
    'aUtHeNtIcAtIoN-rEsUlTs: MX.GOOGLE.COM; SPF=PASS SMTP.MAILFROM=FESPINOZAC2@GMAIL.COM;',
    '\tDKIM=PASS HEADER.D=GMAIL.COM; DMARC=PASS HEADER.FROM=GMAIL.COM'
  ].join('\r\n');
  assert.equal(runtime.context.facturaImportacionAutenticarCabeceras(upper, config).autorizado, true);

  for (const [headers, reason] of [
    [authenticationHeaders().replace(/spf=pass[^;]*/, ''), 'SPF_AUSENTE'],
    [authenticationHeaders().replace(/dkim=pass[^;]*/, ''), 'DKIM_AUSENTE'],
    [authenticationHeaders().replace(/dmarc=pass[^;]*/, ''), 'DMARC_AUSENTE']
  ] as const) {
    const result = runtime.context.facturaImportacionAutenticarCabeceras(headers, config);
    assert.equal(result.autorizado, false);
    assert.equal(result.motivo, reason);
  }
  const misalignedDmarc = runtime.context.facturaImportacionAutenticarCabeceras(
    authenticationHeaders({ fromDomain: 'example.com' }), config);
  assert.equal(misalignedDmarc.autorizado, false);
  assert.equal(misalignedDmarc.motivo, 'DMARC_INVALIDO');
});

test('HU-030 Apps Script: canonical de nueve líneas y HMAC coinciden con Node/backend', () => {
  const runtime = makeRuntime();
  const canonical = runtime.context.construirCanonicalFacturaImportacion({
    keyId: 'test-current', timestampTexto: '1792886400', nonce: 'a0000000-b000-4c00-8000-000000000001',
    gmailMessageId: 'gmail-1', sha256Xml: 'a'.repeat(64), sha256Pdf: null
  });
  assert.equal(canonical, [
    'EPSA-HU030-HMAC-V1', 'POST', '/api/integraciones/facturas', 'test-current', '1792886400',
    'a0000000-b000-4c00-8000-000000000001', 'gmail-1', 'a'.repeat(64), '-'
  ].join('\n'));
  assert.equal(canonical.endsWith('\n'), false);
  assert.equal(runtime.context.firmaHmacFacturaImportacion(canonical, SECRET), `v1=${createHmac('sha256', SECRET).update(canonical, 'utf8').digest('hex')}`);
  assert.throws(() => runtime.context.construirCanonicalFacturaImportacion({ ...{}, keyId: '', timestampTexto: '01' }), /CANONICAL_INVALIDA/);
});

test('HU-030 Apps Script: nonce UUID y timestamp Unix canónico', () => {
  const runtime = makeRuntime();
  const nonce = runtime.context.nuevoNonceFacturaImportacion();
  assert.equal(nonce, nonce.toLowerCase());
  assert.equal(runtime.context.validarNonceFacturaImportacion(nonce), true);
  assert.equal(runtime.context.timestampUnixFacturaImportacion(1_792_886_400_999), '1792886400');
  assert.throws(() => runtime.context.timestampUnixFacturaImportacion(-1), /TIMESTAMP_INVALIDO/);
});

test('HU-030 Apps Script: clasifica adjuntos, ignora ZIP y empareja solo coincidencias inequívocas', () => {
  const runtime = makeRuntime();
  const x1 = runtime.context.facturaImportacionClasificarAdjunto(blob([1], ' invoice-A.XML ', 'application/xml'));
  const p1 = runtime.context.facturaImportacionClasificarAdjunto(blob([37, 80, 68, 70, 45], 'invoice-a.pdf', 'application/pdf'));
  const zip = runtime.context.facturaImportacionClasificarAdjunto(blob([1], 'invoice.zip', 'application/zip'));
  const pdfOnly = runtime.context.facturaImportacionClasificarAdjuntos([blob([37], 'only.pdf', 'application/pdf')]);
  assert.equal(x1.kind, 'xml');
  assert.equal(p1.kind, 'pdf');
  assert.equal(zip.kind, 'zip');
  assert.equal(pdfOnly.xml.length, 0);
  assert.equal(pdfOnly.pdf.length, 1);

  const oneToOne = runtime.context.emparejarXmlPdfFacturaImportacion([x1], [p1]);
  assert.equal(oneToOne.pairs[0].pdf, p1);
  assert.equal(oneToOne.review, false);
  const twoXml = [
    runtime.context.facturaImportacionClasificarAdjunto(blob([1], 'A.xml', 'application/xml')),
    runtime.context.facturaImportacionClasificarAdjunto(blob([2], 'B.xml', 'application/xml'))
  ];
  const pdfA = runtime.context.facturaImportacionClasificarAdjunto(blob([37, 80, 68, 70, 45], 'A.pdf', 'application/pdf'));
  const unique = runtime.context.emparejarXmlPdfFacturaImportacion(twoXml, [pdfA]);
  assert.equal(unique.pairs[0].pdf, pdfA);
  assert.equal(unique.pairs[1].pdf, null);
  const ambiguous = runtime.context.emparejarXmlPdfFacturaImportacion(twoXml, [pdfA,
    runtime.context.facturaImportacionClasificarAdjunto(blob([37, 80, 68, 70, 45], 'A.PDF', 'application/pdf'))]);
  assert.equal(ambiguous.pairs.every((pair: any) => pair.pdf === null), true);
  assert.equal(ambiguous.review, true);
});

test('HU-030 Apps Script: multipart envía los mismos bytes y solo XML/PDF con headers exactos', () => {
  const runtime = makeRuntime({ fetch: () => response(201, { ok: true, data: {
    codrec: '90000000-0000-4000-8000-000000000001', coddoc: '81', pdfPendiente: false
  } }) });
  const config = { endpoint: 'https://example.invalid/api/integraciones/facturas', keyId: 'local-test-key', secret: SECRET };
  const xmlBytes = [60, 63, 120, 109, 108, 32, 255];
  const pdfBytes = [37, 80, 68, 70, 45, 49];
  const xml = blob(xmlBytes, 'x.xml', 'application/octet-stream');
  const pdf = blob(pdfBytes, 'x.pdf', 'application/octet-stream');
  const queue: any[] = [];
  const result = runtime.context.facturaImportacionEnviarPar(config, 'gmail-msg', xml, pdf, queue, 0, false, Date.now());
  assert.equal(result.state, 'Procesado');
  const call = runtime.calls[0]!;
  assert.equal(call.url, config.endpoint);
  const options = call.request;
  assert.deepEqual(Object.keys(options.headers as object).sort(), [
    'X-EPSA-Key-Id', 'X-EPSA-Timestamp', 'X-EPSA-Nonce', 'X-EPSA-Message-Id',
    'X-EPSA-XML-SHA256', 'X-EPSA-PDF-SHA256', 'X-EPSA-Signature'
  ].sort());
  assert.equal('Authorization' in (options.headers as object), false);
  assert.equal('Content-Type' in (options.headers as object), false);
  assert.deepEqual(Object.keys(options.payload as object).sort(), ['pdf', 'xml']);
  assert.deepEqual(asUnsigned((options.payload as any).xml.getBytes()), Buffer.from(xmlBytes));
  assert.deepEqual(asUnsigned((options.payload as any).pdf.getBytes()), Buffer.from(pdfBytes));
  assert.equal((options.headers as any)['X-EPSA-XML-SHA256'], createHash('sha256').update(Buffer.from(xmlBytes)).digest('hex'));
  assert.equal((options.headers as any)['X-EPSA-PDF-SHA256'], createHash('sha256').update(Buffer.from(pdfBytes)).digest('hex'));

  const noPdfRuntime = makeRuntime({ fetch: () => response(201, { ok: true, data: { pdfPendiente: true } }) });
  const noPdf = noPdfRuntime.context.facturaImportacionConstruirSolicitud(config, 'gmail-msg', blob(xmlBytes, 'x.xml', 'text/xml'), null, 1_792_886_400_000);
  assert.deepEqual(Object.keys(noPdf.payload), ['xml']);
  assert.equal(noPdf.headers['X-EPSA-PDF-SHA256'], '-');
});

test('HU-030 Apps Script: mapea 200/201/202/401/409/422/500/503 y aplica backoff', () => {
  const runtime = makeRuntime();
  const at = 1_792_886_400_000;
  for (const status of [200, 201]) assert.equal(runtime.context.facturaImportacionEstadoHttp(response(status, { data: {} }), 0, at, false).outcome.state, 'Procesado');
  const accepted = runtime.context.facturaImportacionClasificarRespuesta(202, '', 0, at);
  assert.equal(accepted.state, 'Pendiente');
  assert.equal(accepted.retryCount, 0);
  assert.equal(accepted.consumesRetry, false);
  assert.equal(new Date(accepted.nextAttemptAt).getTime() - at, 15 * 60 * 1000);
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(401, '', 0, at).globalStop, true);
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(409, 'NONCE_REPETIDO', 0, at).retryCount, 1);
  for (const code of ['CONFLICTO_DOCUMENTAL', 'PDF_EVIDENCIA_CONFLICTO', 'EVIDENCIA_CONFLICTO', 'INVARIANTE_RECEPCION', 'INTENTO_CERRADO']) {
    assert.equal(runtime.context.facturaImportacionClasificarRespuesta(409, code, 0, at).state, 'Revision');
  }
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(422, 'VALIDACION_DOCUMENTAL_FALLIDA', 0, at).state, 'Revision');
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(400, 'MULTIPART_INVALIDO', 0, at).retry, false);
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(413, 'ARCHIVO_DEMASIADO_GRANDE', 0, at).state, 'Revision');
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(500, '', 0, at).retryCount, 1);
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(503, '', 1, at).nextAttemptAt, new Date(at + 30 * 60 * 1000).toISOString());
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(500, '', 2, at).nextAttemptAt, new Date(at + 60 * 60 * 1000).toISOString());
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(500, '', 3, at).nextAttemptAt, new Date(at + 120 * 60 * 1000).toISOString());
  assert.equal(runtime.context.facturaImportacionClasificarRespuesta(503, '', 4, at).exhausted, true);
});

test('HU-030 Apps Script: cola acotada, persistencia mínima, actualización y eliminación', () => {
  const runtime = makeRuntime();
  const props = {
    getProperty: (key: string) => runtime.scriptValues.get(key) ?? null,
    setProperty: (key: string, value: string) => { runtime.scriptValues.set(key, value); },
    deleteProperty: (key: string) => { runtime.scriptValues.delete(key); }
  };
  const queue: any[] = [];
  const outcome = runtime.context.facturaImportacionClasificarRespuesta(503, '', 0, 1_792_886_400_000);
  runtime.context.facturaImportacionActualizarItemCola(queue, { messageId: 'gmail-id', sha256Xml: 'b'.repeat(64), retryCount: outcome.retryCount, nextAttemptAt: outcome.nextAttemptAt });
  runtime.context.facturaImportacionGuardarCola(queue, props);
  assert.equal(runtime.scriptValues.size, 1);
  const loaded = runtime.context.facturaImportacionCargarCola(props);
  assert.equal(loaded[0].messageId, 'gmail-id');
  assert.equal(loaded[0].sha256Xml, 'b'.repeat(64));
  assert.equal('xml' in loaded[0], false);
  assert.equal('pdf' in loaded[0], false);
  runtime.context.facturaImportacionAplicarResultadoCola(loaded, 'gmail-id', 'b'.repeat(64), { retry: false }, Date.now());
  assert.deepEqual(Array.from(loaded), []);
  assert.equal(runtime.scriptValues.has('HU030_RETRY_QUEUE_JSON'), false);
});

test('HU-030 Apps Script: retry recupera messageId y exige un único XML cuyo hash coincide', () => {
  const xmlTarget = blob([60, 120, 109, 108, 62], 'invoice.xml', 'application/xml');
  const unrelated = blob([60, 111, 116, 104, 101, 114, 62], 'other.xml', 'application/xml');
  const parent = thread('thread-retry', []);
  const email = message('msg-retry', new Date(), [unrelated, xmlTarget], parent);
  parent.getMessages = () => [email];
  const targetHash = createHash('sha256').update(asUnsigned(xmlTarget.getBytes())).digest('hex');
  const runtime = makeRuntime({
    messages: { 'msg-retry': email },
    fetch: () => response(200, { ok: true, data: { pdfPendiente: false } })
  });
  const queue: any[] = [{ messageId: 'msg-retry', sha256Xml: targetHash, retryCount: 1,
    nextAttemptAt: new Date(Date.now() - 60_000).toISOString() }];
  const retryOutcome = runtime.context.facturaImportacionRecuperarRetry(queue[0],
    clientConfig(),
    queue, {}, {}, Date.now());
  assert.equal(runtime.calls.length, 1, JSON.stringify({ retryOutcome, logs: runtime.logs }));
  const retryHeaders = runtime.calls[0]?.request.headers as Record<string, string>;
  assert.equal(retryHeaders['X-EPSA-Message-Id'], 'msg-retry');
  assert.equal(retryHeaders['X-EPSA-XML-SHA256'], targetHash);
  assert.equal(queue.length, 0);
});

test('HU-030 Apps Script: retry sin XML exacto va a revisión y bloquea el envío de otro adjunto del mensaje', () => {
  const otherXml = blob([60, 111, 116, 104, 101, 114, 62], 'other.xml', 'application/xml');
  const parent = thread('thread-mismatch', []);
  const email = message('msg-mismatch', new Date(), [otherXml], parent);
  const runtime = makeRuntime({ messages: { 'msg-mismatch': email } });
  const expectedHash = 'c'.repeat(64);
  const queue: any[] = [{ messageId: 'msg-mismatch', sha256Xml: expectedHash, retryCount: 1,
    nextAttemptAt: new Date(Date.now() - 60_000).toISOString() }];
  const attempted: Record<string, boolean> = {};
  const result = runtime.context.facturaImportacionRecuperarRetry(queue[0],
    clientConfig(),
    queue, {}, attempted, Date.now());
  assert.equal(result.state, 'Revision');
  assert.equal(attempted['msg-mismatch|*'], true);
  assert.equal(queue.length, 0);
  runtime.context.facturaImportacionProcesarMensaje(clientConfig(), email, queue, {}, attempted);
  assert.equal(runtime.calls.length, 0);
});

test('HU-030 Apps Script: fecha de corte inclusiva, solapamiento y último barrido ISO', () => {
  const runtime = makeRuntime();
  const cutoff = Date.parse('2026-10-01T12:00:00Z');
  const first = runtime.context.facturaImportacionVentanaBarrido({ cutoffMs: cutoff, lastSweepMs: null, remitentesAutorizados: [AUTHORIZED_SENDER] }, cutoff + 1000);
  assert.equal(runtime.context.facturaImportacionFechaEnVentana(cutoff, first), true);
  assert.equal(runtime.context.facturaImportacionFechaEnVentana(cutoff - 1, first), false);
  assert.match(first.gmailQuery, /has:attachment \{filename:xml filename:pdf\} \{from:fespinozac2@gmail\.com\} after:/);
  const later = runtime.context.facturaImportacionVentanaBarrido({ cutoffMs: cutoff, lastSweepMs: cutoff + 60 * 60 * 1000, remitentesAutorizados: [AUTHORIZED_SENDER] }, cutoff + 61 * 60 * 1000);
  assert.equal(later.startMs, cutoff + 45 * 60 * 1000);
  assert.equal(runtime.context.facturaImportacionFechaEnVentana(later.endMs + 1, later), false);
  const values = new Map<string, string>();
  runtime.context.facturaImportacionGuardarUltimoBarrido({ setProperty: (key: string, value: string) => values.set(key, value) }, cutoff);
  assert.equal(values.get('HU030_ULTIMO_BARRIDO_ISO'), '2026-10-01T12:00:00.000Z');
});

test('HU-030 Apps Script: labels agregadas priorizan revisión/error/pendiente y lock siempre se libera', () => {
  const runtime = makeRuntime();
  assert.equal(runtime.context.facturaImportacionEstadoThreadAgregado(['Procesado', 'Pendiente']), 'Pendiente');
  assert.equal(runtime.context.facturaImportacionEstadoThreadAgregado(['Error', 'Pendiente']), 'Error');
  assert.equal(runtime.context.facturaImportacionEstadoThreadAgregado(['Revision', 'Procesado']), 'Revision');
  assert.equal(runtime.context.facturaImportacionEstadoThreadAgregado(['Procesado']), 'Procesado');
  const priorReview = thread('prior-review', [], ['EPSA/HU030/Revision']);
  const aggregate: Record<string, any> = {};
  runtime.context.facturaImportacionAgregarEstadoThread(aggregate, priorReview, 'Procesado', {
    Procesado: 'EPSA/HU030/Procesado', Pendiente: 'EPSA/HU030/Pendiente',
    Revision: 'EPSA/HU030/Revision', Error: 'EPSA/HU030/Error'
  });
  assert.equal(runtime.context.facturaImportacionEstadoThreadAgregado(aggregate['prior-review'].states), 'Revision');
  runtime.context.facturaImportacionAplicarLabelThread(priorReview, null, {
    Procesado: 'EPSA/HU030/Procesado', Pendiente: 'EPSA/HU030/Pendiente',
    Revision: 'EPSA/HU030/Revision', Error: 'EPSA/HU030/Error'
  });
  const skippedLabel = runtime.logs.map((line) => JSON.parse(line)).find((entry) => entry.evento === 'LABEL_THREAD_OMITIDA');
  assert.equal(skippedLabel.threadId, 'prior-review');
  assert.equal(skippedLabel.estadoThread, null);
  assert.deepEqual(skippedLabel.labelsAntes, ['EPSA/HU030/Revision']);
  assert.deepEqual(skippedLabel.labelsDespues, ['EPSA/HU030/Revision']);
  configure(runtime);
  runtime.context.procesarCorreosPendientes();
  assert.equal(runtime.lockReleased, true);
  assert.equal(runtime.scriptValues.has('HU030_ULTIMO_BARRIDO_ISO'), true);

  const busy = makeRuntime({ lockResult: false });
  configure(busy);
  busy.context.procesarCorreosPendientes();
  assert.equal(busy.searchCount, 0);
  assert.equal(busy.lockReleased, false);
});

test('HU-030 Apps Script: polling respeta fecha exacta, labels thread y no adelanta cursor con lote truncado', () => {
  const now = Date.now();
  const cutoffIso = new Date(now - 10_000).toISOString();
  const xml = blob([60, 120, 109, 108, 62], 'invoice.xml', 'application/xml');
  const parent = thread('thread-cutoff', []);
  const oldMessage = message('msg-old', new Date(now - 20_000), [xml], parent);
  const exactMessage = message('msg-exact', new Date(cutoffIso), [xml], parent);
  parent.getMessages = () => [oldMessage, exactMessage];
  const runtime = makeRuntime({ search: () => [parent], fetch: () => response(201, { ok: true, data: { pdfPendiente: false } }) });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', cutoffIso);
  runtime.context.procesarCorreosPendientes();
  assert.equal(runtime.calls.length, 1, JSON.stringify(runtime.logs));
  assert.equal((runtime.calls[0]?.request.headers as Record<string, string>)['X-EPSA-Message-Id'], 'msg-exact');
  assert.equal(parent.attached.includes('EPSA/HU030/Procesado'), true);

  const oldCursor = new Date(now - 60_000).toISOString();
  const one = thread('overload-1', []);
  const two = thread('overload-2', []);
  const overloaded = makeRuntime({ search: () => [one, two] });
  configure(overloaded);
  overloaded.scriptValues.set('HU030_ULTIMO_BARRIDO_ISO', oldCursor);
  overloaded.scriptValues.set('HU030_LOTE_MAX', '1');
  overloaded.context.procesarCorreosPendientes();
  assert.equal(overloaded.scriptValues.get('HU030_ULTIMO_BARRIDO_ISO'), oldCursor);
});

test('HU-030 Apps Script: registra verificación sanitizada de label en éxito', () => {
  const now = Date.now();
  const cutoffIso = new Date(now - 60_000).toISOString();
  const xml = blob([60, 120, 109, 108, 62], 'invoice.xml', 'application/xml');
  const parent = thread('thread-label-log', [], ['Cliente/Importante']);
  const email = message('msg-label-log', new Date(now - 10_000), [xml], parent);
  parent.getMessages = () => [email];
  const runtime = makeRuntime({ search: () => [parent], fetch: () => response(201, { ok: true, data: { pdfPendiente: false } }) });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', cutoffIso);
  runtime.context.procesarCorreosPendientes();

  assert.deepEqual(parent.currentLabels.sort(), ['Cliente/Importante', 'EPSA/HU030/Procesado']);
  const labelEvent = runtime.logs.map((line) => JSON.parse(line)).find((entry) => entry.evento === 'LABEL_THREAD_APLICADA');
  assert.ok(labelEvent);
  assert.equal(labelEvent.threadId, 'thread-label-log');
  assert.equal(labelEvent.estadoThread, 'Procesado');
  assert.equal(labelEvent.labelObjetivo, 'EPSA/HU030/Procesado');
  assert.deepEqual(labelEvent.labelsAntes, []);
  assert.deepEqual(labelEvent.labelsDespues, ['EPSA/HU030/Procesado']);
  assert.equal(labelEvent.labelConfirmada, true);
  assert.equal(JSON.stringify(labelEvent).includes('invoice.xml'), false);
});

test('HU-030 Apps Script: Pendiente previo por PDF sobrevive a otro mensaje exitoso sin retry en cola', () => {
  const firstRunNow = Date.now();
  const cutoffIso = new Date(firstRunNow - 2 * 60 * 60 * 1000).toISOString();
  const xmlA = blob([60, 97, 47, 62], 'invoice-a.xml', 'application/xml');
  const xmlB = blob([60, 98, 47, 62], 'invoice-b.xml', 'application/xml');
  const parent = thread('thread-pdf-pending-sibling', []);
  const messageA = message('msg-pdf-pending-a', new Date(firstRunNow - 60 * 60 * 1000), [xmlA], parent);
  const messages = [messageA];
  parent.getMessages = () => messages;
  let responseBody = { ok: true, data: { pdfPendiente: true } };
  const runtime = makeRuntime({
    search: () => [parent],
    fetch: () => response(201, responseBody)
  });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', cutoffIso);

  runtime.context.procesarCorreosPendientes();
  assert.deepEqual(parent.currentLabels, ['EPSA/HU030/Pendiente']);
  assert.equal(runtime.scriptValues.has('HU030_RETRY_QUEUE_JSON'), false);

  const messageB = message('msg-success-b', new Date(Date.now()), [xmlB], parent);
  messages.push(messageB);
  responseBody = { ok: true, data: { pdfPendiente: false } };
  runtime.context.procesarCorreosPendientes();

  assert.equal(runtime.calls.length, 2);
  assert.equal((runtime.calls[1]?.request.headers as Record<string, string>)['X-EPSA-Message-Id'], 'msg-success-b');
  assert.deepEqual(parent.currentLabels, ['EPSA/HU030/Pendiente']);
  assert.equal(runtime.scriptValues.has('HU030_RETRY_QUEUE_JSON'), false);
  const labelEvent = runtime.logs.map((line) => JSON.parse(line))
    .filter((entry) => entry.evento === 'LABEL_THREAD_APLICADA' && entry.threadId === 'thread-pdf-pending-sibling').pop();
  assert.equal(labelEvent.estadoThread, 'Pendiente');
  assert.equal(labelEvent.labelObjetivo, 'EPSA/HU030/Pendiente');
  assert.deepEqual(labelEvent.labelsAntes, ['EPSA/HU030/Pendiente']);
  assert.deepEqual(labelEvent.labelsDespues, ['EPSA/HU030/Pendiente']);
  assert.equal(labelEvent.labelConfirmada, true);
});

test('HU-030 Apps Script: conserva Pendiente si sigue existiendo otro retry del mismo thread', () => {
  const now = Date.now();
  const cutoffIso = new Date(now - 60_000).toISOString();
  const xml = blob([60, 120, 109, 108, 62], 'invoice.xml', 'application/xml');
  const parent = thread('thread-pending-sibling', [], ['EPSA/HU030/Pendiente']);
  const current = message('msg-current', new Date(now - 10_000), [xml], parent);
  const sibling = message('msg-pending-sibling', new Date(now - 120_000), [], parent);
  parent.getMessages = () => [current, sibling];
  const runtime = makeRuntime({ search: () => [parent], fetch: () => response(200, { ok: true, data: { pdfPendiente: false } }) });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', cutoffIso);
  runtime.scriptValues.set('HU030_RETRY_QUEUE_JSON', JSON.stringify([{
    messageId: 'msg-pending-sibling', sha256Xml: 'd'.repeat(64), retryCount: 0,
    nextAttemptAt: new Date(now + 60 * 60 * 1000).toISOString()
  }]));
  runtime.context.procesarCorreosPendientes();

  assert.deepEqual(parent.currentLabels, ['EPSA/HU030/Pendiente']);
  const labelEvent = runtime.logs.map((line) => JSON.parse(line)).find((entry) => entry.threadId === 'thread-pending-sibling');
  assert.equal(labelEvent.estadoThread, 'Pendiente');
  assert.equal(labelEvent.labelObjetivo, 'EPSA/HU030/Pendiente');
  assert.equal(labelEvent.labelConfirmada, true);
});

test('HU-030 Apps Script: conserva Pendiente calculada en la ejecución aunque la cola esté vacía', () => {
  const now = Date.now();
  const cutoffIso = new Date(now - 60_000).toISOString();
  const xml = blob([60, 120, 109, 108, 62], 'invoice.xml', 'application/xml');
  const parent = thread('thread-pdf-pending', []);
  const email = message('msg-pdf-pending', new Date(now - 10_000), [xml], parent);
  parent.getMessages = () => [email];
  const runtime = makeRuntime({ search: () => [parent], fetch: () => response(201, { ok: true, data: { pdfPendiente: true } }) });
  configure(runtime);
  runtime.scriptValues.set('HU030_FECHA_CORTE_ISO', cutoffIso);
  runtime.context.procesarCorreosPendientes();

  assert.deepEqual(parent.currentLabels, ['EPSA/HU030/Pendiente']);
  const labelEvent = runtime.logs.map((line) => JSON.parse(line)).find((entry) => entry.threadId === 'thread-pdf-pending');
  assert.equal(labelEvent.estadoThread, 'Pendiente');
  assert.equal(labelEvent.labelConfirmada, true);
});

test('HU-030 Apps Script: búsqueda pagina Gmail y detiene el lote ante 401', () => {
  const allThreads = Array.from({ length: 101 }, (_value, index) => thread(`page-${index}`, []));
  const paged = makeRuntime({ search: (_query, start, max) => allThreads.slice(start, start + max) });
  configure(paged);
  paged.scriptValues.set('HU030_LOTE_MAX', '100');
  paged.context.procesarCorreosPendientes();
  assert.equal(paged.searchCount, 2);
  assert.equal(paged.scriptValues.has('HU030_ULTIMO_BARRIDO_ISO'), false);

  const cutoff = new Date(Date.now() - 1000);
  const oneParent = thread('auth-stop-1', []);
  const twoParent = thread('auth-stop-2', []);
  oneParent.getMessages = () => [message('auth-msg-1', cutoff, [blob([60], 'one.xml', 'application/xml')], oneParent)];
  twoParent.getMessages = () => [message('auth-msg-2', cutoff, [blob([60, 1], 'two.xml', 'application/xml')], twoParent)];
  const authStop = makeRuntime({ search: () => [oneParent, twoParent], fetch: () => response(401, { ok: false, code: 'FIRMA_INVALIDA' }) });
  configure(authStop);
  authStop.scriptValues.set('HU030_FECHA_CORTE_ISO', new Date(Date.now() - 60_000).toISOString());
  authStop.context.procesarCorreosPendientes();
  assert.equal(authStop.calls.length, 1);
  assert.equal(authStop.scriptValues.has('HU030_ULTIMO_BARRIDO_ISO'), false);
});

test('HU-030 Apps Script: trigger solo aparece por llamada explícita y se evitan duplicados', () => {
  const runtime = makeRuntime();
  assert.equal(runtime.createdTriggers.length, 0);
  assert.equal(runtime.context.listarTriggersFacturas().length, 0);
  const first = runtime.context.instalarTriggerFacturas();
  assert.equal(first.installed, true);
  assert.equal(runtime.context.listarTriggersFacturas().length, 1);
  assert.equal(runtime.context.instalarTriggerFacturas().installed, false);
  assert.equal(runtime.createdTriggers.length, 1);
  assert.equal(runtime.context.eliminarTriggersFacturas().deleted, 1);
  assert.equal(runtime.context.listarTriggersFacturas().length, 0);
});
