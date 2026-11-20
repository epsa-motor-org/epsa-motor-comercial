var FACTURA_IMPORTACION_RUTA_CANONICA = '/api/integraciones/facturas';
var FACTURA_IMPORTACION_PREFIJO_CANONICO = 'EPSA-HU030-HMAC-V1';
var FACTURA_IMPORTACION_PROPIEDAD_COLA = 'HU030_RETRY_QUEUE_JSON';
var FACTURA_IMPORTACION_MAX_REINTENTOS = 4;
var FACTURA_IMPORTACION_ESPERAS_REINTENTO_MS = [15, 30, 60, 120].map(function (minutes) { return minutes * 60 * 1000; });
var FACTURA_IMPORTACION_SOLAPAMIENTO_MS = 15 * 60 * 1000;
var FACTURA_IMPORTACION_MAX_COLA = 20;
var FACTURA_IMPORTACION_MAX_JSON_COLA = 8000;
var FACTURA_IMPORTACION_MAX_XML_BYTES = 5 * 1024 * 1024;
var FACTURA_IMPORTACION_MAX_PDF_BYTES = 10 * 1024 * 1024;
var FACTURA_IMPORTACION_MAX_LOTE = 100;
var FACTURA_IMPORTACION_LABELS_DEFAULT = {
  Procesado: 'EPSA/HU030/Procesado',
  Pendiente: 'EPSA/HU030/Pendiente',
  Revision: 'EPSA/HU030/Revision',
  Error: 'EPSA/HU030/Error'
};

function errorFacturaImportacion(codigo) {
  var error = new Error(codigo);
  error.facturaImportacionCode = codigo;
  return error;
}

function bytesFirmadosAHex(bytes) {
  if (!bytes || typeof bytes.length !== 'number') throw errorFacturaImportacion('BYTES_INVALIDOS');
  var hex = [];
  for (var index = 0; index < bytes.length; index += 1) {
    var value = (Number(bytes[index]) + 256) % 256;
    if (!isFinite(value)) throw errorFacturaImportacion('BYTES_INVALIDOS');
    hex.push(('0' + value.toString(16)).slice(-2));
  }
  return hex.join('');
}

function sha256Hex(bytes) {
  return bytesFirmadosAHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
}

function construirCanonicalFacturaImportacion(input) {
  if (!input || !/^[A-Za-z0-9._-]{1,64}$/.test(input.keyId || '')
    || !/^(0|[1-9]\d{0,11})$/.test(input.timestampTexto || '')
    || !validarNonceFacturaImportacion(input.nonce)
    || typeof input.gmailMessageId !== 'string' || !/^[\x21-\x7e]{1,250}$/.test(input.gmailMessageId)
    || !/^[0-9a-f]{64}$/.test(input.sha256Xml || '')
    || (input.sha256Pdf && !/^[0-9a-f]{64}$/.test(input.sha256Pdf))) {
    throw errorFacturaImportacion('CANONICAL_INVALIDA');
  }
  return [
    FACTURA_IMPORTACION_PREFIJO_CANONICO,
    'POST',
    FACTURA_IMPORTACION_RUTA_CANONICA,
    input.keyId,
    input.timestampTexto,
    input.nonce,
    input.gmailMessageId,
    input.sha256Xml,
    input.sha256Pdf || '-'
  ].join('\n');
}

function firmaHmacFacturaImportacion(canonical, secret) {
  return 'v1=' + bytesFirmadosAHex(Utilities.computeHmacSha256Signature(canonical, secret));
}

function validarNonceFacturaImportacion(nonce) {
  return typeof nonce === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce);
}

function nuevoNonceFacturaImportacion() {
  var nonce = String(Utilities.getUuid()).toLowerCase();
  if (!validarNonceFacturaImportacion(nonce)) throw errorFacturaImportacion('NONCE_FORMATO_INVALIDO');
  return nonce;
}

function timestampUnixFacturaImportacion(nowMs) {
  var milliseconds = nowMs === undefined ? Date.now() : Number(nowMs);
  if (!isFinite(milliseconds) || milliseconds < 0) throw errorFacturaImportacion('TIMESTAMP_INVALIDO');
  var timestamp = String(Math.floor(milliseconds / 1000));
  if (!/^(0|[1-9]\d{0,11})$/.test(timestamp)) throw errorFacturaImportacion('TIMESTAMP_INVALIDO');
  return timestamp;
}

function parsearIsoFacturaImportacion(value) {
  if (typeof value !== 'string') return null;
  var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var hour = Number(match[4]);
  var minute = Number(match[5]);
  var second = Number(match[6]);
  var millisecond = Number((match[7] || '').padEnd(3, '0') || '0');
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  var localAsUtc = new Date(0);
  localAsUtc.setUTCFullYear(year, month - 1, day);
  localAsUtc.setUTCHours(hour, minute, second, millisecond);
  if (localAsUtc.getUTCFullYear() !== year || localAsUtc.getUTCMonth() !== month - 1
    || localAsUtc.getUTCDate() !== day || localAsUtc.getUTCHours() !== hour
    || localAsUtc.getUTCMinutes() !== minute || localAsUtc.getUTCSeconds() !== second) return null;
  var offsetMinutes = 0;
  if (match[8] !== 'Z') {
    var offsetHour = Number(match[10]);
    var offsetMinute = Number(match[11]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (match[9] === '+' ? 1 : -1);
  }
  return localAsUtc.getTime() - offsetMinutes * 60 * 1000;
}

function validarEndpointFacturaImportacion(endpoint) {
  if (typeof endpoint !== 'string') return null;
  var normalized = endpoint.trim().replace(/\/$/, '');
  if (!/^https:\/\/[^\/?#@]+\/api\/integraciones\/facturas$/i.test(normalized)) return null;
  return normalized;
}

function facturaImportacionNormalizarEmail(value) {
  if (typeof value !== 'string') return null;
  var email = value.trim();
  if (email.charAt(0) === '<' && email.charAt(email.length - 1) === '>') email = email.slice(1, -1).trim();
  if (email.length > 254 || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email)) return null;
  return email.toLowerCase();
}

function facturaImportacionParsearListaConfiguracion(value, kind) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  var items = value.split(/[,;\r\n]+/).map(function (item) { return item.trim(); });
  if (items.length < 1 || items.length > 50 || items.some(function (item) { return !item; })) return null;
  var normalized = [];
  for (var index = 0; index < items.length; index += 1) {
    var item = kind === 'email' ? facturaImportacionNormalizarEmail(items[index]) : items[index].toLowerCase().replace(/\.$/, '');
    if (kind === 'domain' && (item.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(item))) item = null;
    if (!item || normalized.indexOf(item) !== -1) return null;
    normalized.push(item);
  }
  return normalized;
}

function facturaImportacionParsearCabeceras(rawContent) {
  if (typeof rawContent !== 'string' || rawContent.length === 0) return null;
  var separator = /\r?\n\r?\n/.exec(rawContent);
  var rawHeaders = separator ? rawContent.slice(0, separator.index) : rawContent;
  if (rawHeaders.length > 262144) return null;
  var unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, ' ');
  var lines = unfolded.split(/\r?\n/);
  var headers = {};
  for (var index = 0; index < lines.length; index += 1) {
    var match = /^([!-9;-~]+):[ \t]*(.*)$/.exec(lines[index]);
    if (!match) return null;
    var name = match[1].toLowerCase();
    if (name === 'from' || name === 'authentication-results') {
      if (!headers[name]) headers[name] = [];
      headers[name].push(match[2].trim());
    }
  }
  return headers;
}

function facturaImportacionEmailDeFrom(value) {
  if (typeof value !== 'string') return null;
  var trimmed = value.trim();
  var openCount = (trimmed.match(/</g) || []).length;
  var closeCount = (trimmed.match(/>/g) || []).length;
  if (openCount === 1 && closeCount === 1) {
    var match = /<([^<>]+)>/.exec(trimmed);
    return match ? facturaImportacionNormalizarEmail(match[1]) : null;
  }
  if (openCount !== 0 || closeCount !== 0 || /[,;]/.test(trimmed)) return null;
  return facturaImportacionNormalizarEmail(trimmed);
}

function facturaImportacionCamposResultadoAuth(segment) {
  var fields = {};
  var regex = /(?:^|\s)(smtp\.mailfrom|header\.d|header\.i|header\.from)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;]+))/ig;
  var match;
  while ((match = regex.exec(segment)) !== null) fields[match[1].toLowerCase()] = match[2] || match[3] || match[4] || '';
  return fields;
}

function facturaImportacionResultadosAuth(headerValue) {
  if (typeof headerValue !== 'string') return null;
  var segments = headerValue.split(';');
  if (segments.length < 2 || segments[0].trim().toLowerCase() !== 'mx.google.com') return null;
  var results = [];
  for (var index = 1; index < segments.length; index += 1) {
    var match = /^\s*(spf|dkim|dmarc)\s*=\s*([a-z][a-z0-9_-]*)\b(.*)$/i.exec(segments[index]);
    if (match) results.push({ method: match[1].toLowerCase(), result: match[2].toLowerCase(), fields: facturaImportacionCamposResultadoAuth(match[3]) });
  }
  return results;
}

function facturaImportacionDominioAuth(value) {
  if (typeof value !== 'string') return null;
  var normalized = value.trim().toLowerCase().replace(/^<|>$/g, '').replace(/\.$/, '');
  if (normalized.indexOf('@') !== -1) normalized = normalized.slice(normalized.lastIndexOf('@') + 1);
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized) ? normalized : null;
}

function facturaImportacionDominiosRemitentesConfigurados(senders, domains) {
  return Array.isArray(senders) && senders.length > 0 && Array.isArray(domains) && domains.length > 0
    && senders.every(function (sender) {
      return typeof sender === 'string' && domains.indexOf(sender.slice(sender.lastIndexOf('@') + 1).toLowerCase()) !== -1;
    });
}

function facturaImportacionAutenticarCabeceras(rawContent, config) {
  if (!config || !Array.isArray(config.remitentesAutorizados) || !config.remitentesAutorizados.length
    || !Array.isArray(config.dominiosAutenticacion) || !config.dominiosAutenticacion.length
    || !facturaImportacionDominiosRemitentesConfigurados(config.remitentesAutorizados, config.dominiosAutenticacion)) {
    return { autorizado: false, estado: 'REVISION', motivo: 'CONFIGURACION_AUTENTICACION_INCOMPLETA' };
  }
  var headers = facturaImportacionParsearCabeceras(rawContent);
  if (!headers || !headers.from || headers.from.length !== 1) {
    return { autorizado: false, estado: 'REVISION', motivo: 'REMITENTE_NO_VERIFICABLE' };
  }
  var sender = facturaImportacionEmailDeFrom(headers.from[0]);
  if (!sender) return { autorizado: false, estado: 'REVISION', motivo: 'REMITENTE_NO_VERIFICABLE' };
  if (config.remitentesAutorizados.indexOf(sender) === -1) {
    return { autorizado: false, estado: 'EXCLUIDO', motivo: 'REMITENTE_NO_AUTORIZADO' };
  }
  var senderDomain = sender.slice(sender.lastIndexOf('@') + 1);
  var authHeaders = headers['authentication-results'] || [];
  if (authHeaders.length === 0) return { autorizado: false, estado: 'REVISION', motivo: 'AUTHENTICATION_RESULTS_AUSENTE' };
  // Si hay más de un resultado, no es posible demostrar cuál fue agregado por el receptor.
  if (authHeaders.length !== 1) return { autorizado: false, estado: 'REVISION', motivo: 'AUTHENTICATION_RESULTS_AMBIGUO' };
  var authResults = facturaImportacionResultadosAuth(authHeaders[0]);
  if (!authResults) return { autorizado: false, estado: 'REVISION', motivo: 'AUTHENTICATION_RESULTS_NO_CONFIABLE' };

  var spf = authResults.filter(function (entry) { return entry.method === 'spf'; });
  if (spf.length === 0) return { autorizado: false, estado: 'REVISION', motivo: 'SPF_AUSENTE' };
  var spfValid = spf.some(function (entry) {
    return entry.result === 'pass' && facturaImportacionNormalizarEmail(entry.fields['smtp.mailfrom']) === sender;
  });
  if (!spfValid) return { autorizado: false, estado: 'REVISION', motivo: 'SPF_INVALIDO' };

  var dkim = authResults.filter(function (entry) { return entry.method === 'dkim'; });
  if (dkim.length === 0) return { autorizado: false, estado: 'REVISION', motivo: 'DKIM_AUSENTE' };
  var dkimValid = dkim.some(function (entry) {
    if (entry.result !== 'pass') return false;
    var domain = facturaImportacionDominioAuth(entry.fields['header.d'] || entry.fields['header.i']);
    return domain !== null && config.dominiosAutenticacion.indexOf(domain) !== -1;
  });
  if (!dkimValid) return { autorizado: false, estado: 'REVISION', motivo: 'DKIM_INVALIDO' };

  var dmarc = authResults.filter(function (entry) { return entry.method === 'dmarc'; });
  if (dmarc.length === 0) return { autorizado: false, estado: 'REVISION', motivo: 'DMARC_AUSENTE' };
  var dmarcValid = dmarc.some(function (entry) {
    var domain = facturaImportacionDominioAuth(entry.fields['header.from']);
    return entry.result === 'pass' && domain === senderDomain && config.dominiosAutenticacion.indexOf(domain) !== -1;
  });
  if (!dmarcValid) return { autorizado: false, estado: 'REVISION', motivo: 'DMARC_INVALIDO' };
  return { autorizado: true, estado: 'AUTORIZADO', motivo: 'ORIGEN_AUTENTICADO' };
}

function facturaImportacionAutenticarMensaje(config, message) {
  try {
    if (!config || !Array.isArray(config.remitentesAutorizados) || !config.remitentesAutorizados.length
      || !Array.isArray(config.dominiosAutenticacion) || !config.dominiosAutenticacion.length
      || !facturaImportacionDominiosRemitentesConfigurados(config.remitentesAutorizados, config.dominiosAutenticacion)) {
      return { autorizado: false, estado: 'REVISION', motivo: 'CONFIGURACION_AUTENTICACION_INCOMPLETA' };
    }
    if (!message || typeof message.getFrom !== 'function') {
      return { autorizado: false, estado: 'REVISION', motivo: 'REMITENTE_NO_VERIFICABLE' };
    }
    var fromAddress = facturaImportacionEmailDeFrom(message.getFrom());
    if (!fromAddress) return { autorizado: false, estado: 'REVISION', motivo: 'REMITENTE_NO_VERIFICABLE' };
    if (config.remitentesAutorizados.indexOf(fromAddress) === -1) {
      return { autorizado: false, estado: 'EXCLUIDO', motivo: 'REMITENTE_NO_AUTORIZADO' };
    }
    if (!message || typeof message.getRawContent !== 'function') {
      return { autorizado: false, estado: 'REVISION', motivo: 'AUTHENTICATION_RESULTS_NO_VERIFICABLE' };
    }
    return facturaImportacionAutenticarCabeceras(message.getRawContent(), config);
  } catch (_error) {
    return { autorizado: false, estado: 'REVISION', motivo: 'AUTHENTICATION_RESULTS_NO_VERIFICABLE' };
  }
}

function facturaImportacionLeerConfiguracion() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var endpoint = validarEndpointFacturaImportacion(scriptProperties.getProperty('HU030_ENDPOINT_URL'));
  var keyId = scriptProperties.getProperty('HU030_HMAC_KEY_ID');
  var secret = scriptProperties.getProperty('HU030_HMAC_SECRET');
  var cutoffIso = scriptProperties.getProperty('HU030_FECHA_CORTE_ISO');
  var cutoffMs = parsearIsoFacturaImportacion(cutoffIso);
  if (!endpoint || !keyId || !/^[A-Za-z0-9._-]{1,64}$/.test(keyId)
    || typeof secret !== 'string' || secret.length === 0
    || /[\r\n\u0000-\u001f\u007f]/.test(secret)
    || unescape(encodeURIComponent(secret)).length < 32
    || cutoffMs === null) throw errorFacturaImportacion('CONFIGURACION_INCOMPLETA');

  var remitentesAutorizados = facturaImportacionParsearListaConfiguracion(
    scriptProperties.getProperty('HU030_REMITENTES_AUTORIZADOS'), 'email');
  var dominiosAutenticacion = facturaImportacionParsearListaConfiguracion(
    scriptProperties.getProperty('HU030_DOMINIOS_AUTENTICACION'), 'domain');
  if (!remitentesAutorizados || !dominiosAutenticacion
    || !facturaImportacionDominiosRemitentesConfigurados(remitentesAutorizados, dominiosAutenticacion)) {
    throw errorFacturaImportacion('CONFIGURACION_AUTENTICACION_INCOMPLETA');
  }

  var lastSweepIso = scriptProperties.getProperty('HU030_ULTIMO_BARRIDO_ISO');
  var lastSweepMs = lastSweepIso ? parsearIsoFacturaImportacion(lastSweepIso) : null;
  if (lastSweepIso && lastSweepMs === null) throw errorFacturaImportacion('CONFIGURACION_ULTIMO_BARRIDO_INVALIDA');

  var rawBatch = scriptProperties.getProperty('HU030_LOTE_MAX');
  var batchMax = rawBatch === null || rawBatch === '' ? 25 : Number(rawBatch);
  if (!Number.isInteger(batchMax) || batchMax < 1 || batchMax > FACTURA_IMPORTACION_MAX_LOTE) {
    throw errorFacturaImportacion('CONFIGURACION_LOTE_INVALIDA');
  }

  var labels = {};
  Object.keys(FACTURA_IMPORTACION_LABELS_DEFAULT).forEach(function (state) {
    var configured = scriptProperties.getProperty('HU030_LABEL_' + state.toUpperCase());
    var name = configured || FACTURA_IMPORTACION_LABELS_DEFAULT[state];
    if (typeof name !== 'string' || name.trim() !== name || name.length < 1 || name.length > 120) {
      throw errorFacturaImportacion('CONFIGURACION_LABEL_INVALIDA');
    }
    labels[state] = name;
  });
  if (Object.keys(labels).map(function (state) { return labels[state]; }).filter(function (name, index, all) {
    return all.indexOf(name) === index;
  }).length !== Object.keys(labels).length) throw errorFacturaImportacion('CONFIGURACION_LABEL_DUPLICADA');
  return {
    endpoint: endpoint,
    keyId: keyId,
    secret: secret,
    cutoffIso: cutoffIso,
    cutoffMs: cutoffMs,
    lastSweepIso: lastSweepIso || null,
    lastSweepMs: lastSweepMs,
    batchMax: batchMax,
    remitentesAutorizados: remitentesAutorizados,
    dominiosAutenticacion: dominiosAutenticacion,
    labels: labels
  };
}

function facturaImportacionVentanaBarrido(config, nowMs) {
  var startMs = config.lastSweepMs === null
    ? config.cutoffMs
    : Math.max(config.cutoffMs, config.lastSweepMs - FACTURA_IMPORTACION_SOLAPAMIENTO_MS);
  var coarseDate = new Date(startMs - 24 * 60 * 60 * 1000);
  var dateText = Utilities.formatDate(coarseDate, 'America/Lima', 'yyyy/MM/dd');
  var senderQuery = '{' + config.remitentesAutorizados.map(function (sender) { return 'from:' + sender; }).join(' ') + '}';
  return {
    startMs: startMs,
    endMs: nowMs === undefined ? Date.now() : nowMs,
    gmailQuery: 'has:attachment {filename:xml filename:pdf} ' + senderQuery + ' after:' + dateText
  };
}

function facturaImportacionFechaEnVentana(messageDate, window) {
  var messageMs = messageDate instanceof Date ? messageDate.getTime() : Number(messageDate);
  return isFinite(messageMs) && messageMs >= window.startMs && messageMs <= window.endMs;
}

function facturaImportacionGuardarUltimoBarrido(properties, dateMs) {
  properties.setProperty('HU030_ULTIMO_BARRIDO_ISO', new Date(dateMs).toISOString());
}

function facturaImportacionBytesDeBlob(blob) {
  if (!blob || typeof blob.getBytes !== 'function') throw errorFacturaImportacion('ADJUNTO_INVALIDO');
  return blob.getBytes();
}

function facturaImportacionNombreBlob(blob) {
  return typeof blob.getName === 'function' ? String(blob.getName() || '') : '';
}

function facturaImportacionMimeBlob(blob) {
  return typeof blob.getContentType === 'function' ? String(blob.getContentType() || '').toLowerCase() : '';
}

function facturaImportacionClasificarAdjunto(blob) {
  var name = facturaImportacionNombreBlob(blob);
  var mime = facturaImportacionMimeBlob(blob).split(';')[0].trim();
  var extension = /\.([^.\\/]+)$/.exec(name);
  var ext = extension ? extension[1].toLowerCase() : '';
  if (ext === 'zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed') {
    return { kind: 'zip', blob: blob, name: name, mime: mime };
  }
  var isXmlMime = mime === 'application/xml' || mime === 'text/xml' || mime === 'application/soap+xml';
  var isPdfMime = mime === 'application/pdf';
  var isXmlExt = ext === 'xml';
  var isPdfExt = ext === 'pdf';
  if ((isXmlMime || isXmlExt) && (isPdfMime || isPdfExt)) {
    return { kind: 'ambiguous', blob: blob, name: name, mime: mime };
  }
  if (isXmlMime || isXmlExt) return { kind: 'xml', blob: blob, name: name, mime: mime };
  if (isPdfMime || isPdfExt) return { kind: 'pdf', blob: blob, name: name, mime: mime };
  return { kind: 'other', blob: blob, name: name, mime: mime };
}

function facturaImportacionClasificarAdjuntos(blobs) {
  var result = { xml: [], pdf: [], zip: [], other: [], ambiguous: [] };
  (blobs || []).forEach(function (blob) {
    var item = facturaImportacionClasificarAdjunto(blob);
    result[item.kind].push(item);
  });
  return result;
}

function facturaImportacionBaseName(name) {
  var normalized = String(name || '').replace(/\\/g, '/').split('/').pop().trim();
  return normalized.replace(/\.[^.]*$/, '').toLowerCase();
}

function emparejarXmlPdfFacturaImportacion(xmls, pdfs) {
  var pairs = [];
  var unmatchedPdfs = [];
  var review = false;
  if (xmls.length === 1 && pdfs.length === 1) {
    return { pairs: [{ xml: xmls[0], pdf: pdfs[0], review: false }], unmatchedPdfs: [], review: false };
  }
  if (pdfs.length === 0) {
    return { pairs: xmls.map(function (xml) { return { xml: xml, pdf: null, review: false }; }), unmatchedPdfs: [], review: false };
  }
  var pdfUses = pdfs.map(function () { return 0; });
  var matches = xmls.map(function (xml) {
    var base = facturaImportacionBaseName(xml.name);
    var found = [];
    if (base) pdfs.forEach(function (pdf, index) {
      if (facturaImportacionBaseName(pdf.name) === base) found.push(index);
    });
    return found;
  });
  matches.forEach(function (found) { found.forEach(function (index) { pdfUses[index] += 1; }); });
  matches.forEach(function (found, index) {
    if (found.length === 1 && pdfUses[found[0]] === 1) {
      pairs.push({ xml: xmls[index], pdf: pdfs[found[0]], review: false });
      pdfUses[found[0]] = -1;
    } else {
      pairs.push({ xml: xmls[index], pdf: null, review: true });
      review = true;
    }
  });
  pdfUses.forEach(function (usage, index) {
    if (usage !== -1) {
      unmatchedPdfs.push(pdfs[index]);
      review = true;
    }
  });
  return { pairs: pairs, unmatchedPdfs: unmatchedPdfs, review: review };
}

function facturaImportacionAjustarMimeBlob(blob, mime) {
  if (typeof blob.setContentType !== 'function') return blob;
  var adjusted = blob.setContentType(mime);
  return adjusted && typeof adjusted.getBytes === 'function' ? adjusted : blob;
}

function facturaImportacionConstruirSolicitud(config, gmailMessageId, xmlBlob, pdfBlob, nowMs) {
  if (typeof gmailMessageId !== 'string' || !/^[\x21-\x7e]{1,250}$/.test(gmailMessageId)) {
    throw errorFacturaImportacion('MESSAGE_ID_INVALIDO');
  }
  var uploadXml = facturaImportacionAjustarMimeBlob(xmlBlob, 'application/xml');
  var xmlBytes = facturaImportacionBytesDeBlob(uploadXml);
  if (xmlBytes.length > FACTURA_IMPORTACION_MAX_XML_BYTES) throw errorFacturaImportacion('XML_DEMASIADO_GRANDE');
  var sha256Xml = sha256Hex(xmlBytes);
  if (!/^[0-9a-f]{64}$/.test(sha256Xml)) throw errorFacturaImportacion('HASH_XML_INVALIDO');

  var uploadPdf = null;
  var sha256Pdf = null;
  if (pdfBlob) {
    uploadPdf = facturaImportacionAjustarMimeBlob(pdfBlob, 'application/pdf');
    var pdfBytes = facturaImportacionBytesDeBlob(uploadPdf);
    if (pdfBytes.length > FACTURA_IMPORTACION_MAX_PDF_BYTES) throw errorFacturaImportacion('PDF_DEMASIADO_GRANDE');
    if (bytesFirmadosAHex(pdfBytes.slice(0, 5)) !== bytesFirmadosAHex([37, 80, 68, 70, 45])) {
      throw errorFacturaImportacion('PDF_CABECERA_INVALIDA');
    }
    sha256Pdf = sha256Hex(pdfBytes);
  }

  var timestampTexto = timestampUnixFacturaImportacion(nowMs);
  var nonce = nuevoNonceFacturaImportacion();
  var canonical = construirCanonicalFacturaImportacion({
    keyId: config.keyId,
    timestampTexto: timestampTexto,
    nonce: nonce,
    gmailMessageId: gmailMessageId,
    sha256Xml: sha256Xml,
    sha256Pdf: sha256Pdf
  });
  var signature = firmaHmacFacturaImportacion(canonical, config.secret);
  var headers = {
    'X-EPSA-Key-Id': config.keyId,
    'X-EPSA-Timestamp': timestampTexto,
    'X-EPSA-Nonce': nonce,
    'X-EPSA-Message-Id': gmailMessageId,
    'X-EPSA-XML-SHA256': sha256Xml,
    'X-EPSA-PDF-SHA256': sha256Pdf || '-',
    'X-EPSA-Signature': signature
  };
  var payload = { xml: uploadXml };
  if (uploadPdf) payload.pdf = uploadPdf;
  return { headers: headers, payload: payload, canonical: canonical, sha256Xml: sha256Xml, sha256Pdf: sha256Pdf };
}

function facturaImportacionParsearRespuesta(response) {
  var status = Number(response && typeof response.getResponseCode === 'function' ? response.getResponseCode() : 0);
  var body = {};
  try {
    var text = response && typeof response.getContentText === 'function' ? response.getContentText() : '';
    var parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
  } catch (_error) {
    body = {};
  }
  var data = body.data && typeof body.data === 'object' ? body.data : body;
  var code = typeof body.code === 'string' ? body.code
    : typeof data.code === 'string' ? data.code : '';
  if (!/^[A-Z0-9_]{1,80}$/.test(code)) code = '';
  var codrec = typeof data.codrec === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.codrec)
    ? data.codrec : null;
  var coddoc = (typeof data.coddoc === 'string' || typeof data.coddoc === 'number')
    && /^\d{1,20}$/.test(String(data.coddoc)) ? String(data.coddoc) : null;
  return { status: status, code: code, pdfPending: data.pdfPendiente === true, codrec: codrec, coddoc: coddoc };
}

function facturaImportacionClasificarRespuesta(status, code, retryCount, nowMs) {
  var count = Number(retryCount || 0);
  var now = nowMs === undefined ? Date.now() : nowMs;
  if (status === 200 || status === 201) return { state: 'Procesado', retry: false, retryCount: count };
  if (status === 202) return { state: 'Pendiente', retry: true, retryCount: count, nextAttemptAt: new Date(now + 15 * 60 * 1000).toISOString(), consumesRetry: false };
  if (status === 401) return { state: 'Error', retry: false, retryCount: count, globalStop: true };
  var transientCode = code === 'NONCE_REPETIDO' || code === 'LEASE_PERDIDO';
  if (status === 500 || status === 503 || transientCode || status === 0) {
    if (count >= FACTURA_IMPORTACION_MAX_REINTENTOS) return { state: 'Error', retry: false, retryCount: count, exhausted: true };
    var updatedCount = count + 1;
    return {
      state: 'Pendiente', retry: true, retryCount: updatedCount,
      nextAttemptAt: new Date(now + FACTURA_IMPORTACION_ESPERAS_REINTENTO_MS[count]).toISOString(),
      consumesRetry: true
    };
  }
  if (status === 400 || status === 409 || status === 413 || status === 422
    || ['CONFLICTO_DOCUMENTAL', 'PDF_EVIDENCIA_CONFLICTO', 'EVIDENCIA_CONFLICTO',
      'INVARIANTE_RECEPCION', 'INTENTO_CERRADO'].indexOf(code) !== -1) {
    return { state: 'Revision', retry: false, retryCount: count };
  }
  return { state: 'Error', retry: false, retryCount: count };
}

function facturaImportacionIdentidadCola(messageId, sha256Xml) {
  return messageId + '|' + sha256Xml;
}

function facturaImportacionValidarItemCola(item) {
  var keys = item && typeof item === 'object' ? Object.keys(item).sort().join(',') : '';
  return keys === 'messageId,nextAttemptAt,retryCount,sha256Xml'
    && typeof item.messageId === 'string' && /^[\x21-\x7e]{1,250}$/.test(item.messageId)
    && typeof item.sha256Xml === 'string' && /^[0-9a-f]{64}$/.test(item.sha256Xml)
    && Number.isInteger(item.retryCount) && item.retryCount >= 0 && item.retryCount <= FACTURA_IMPORTACION_MAX_REINTENTOS
    && parsearIsoFacturaImportacion(item.nextAttemptAt) !== null;
}

function facturaImportacionCargarCola(properties) {
  var props = properties || PropertiesService.getScriptProperties();
  var raw = props.getProperty(FACTURA_IMPORTACION_PROPIEDAD_COLA);
  if (!raw) return [];
  if (raw.length > FACTURA_IMPORTACION_MAX_JSON_COLA) throw errorFacturaImportacion('COLA_REINTENTO_CORRUPTA');
  var queue;
  try { queue = JSON.parse(raw); } catch (_error) { throw errorFacturaImportacion('COLA_REINTENTO_CORRUPTA'); }
  if (!Array.isArray(queue) || queue.length > FACTURA_IMPORTACION_MAX_COLA || !queue.every(facturaImportacionValidarItemCola)) {
    throw errorFacturaImportacion('COLA_REINTENTO_CORRUPTA');
  }
  var seen = {};
  queue.forEach(function (item) {
    var identity = facturaImportacionIdentidadCola(item.messageId, item.sha256Xml);
    if (seen[identity]) throw errorFacturaImportacion('COLA_REINTENTO_CORRUPTA');
    seen[identity] = true;
  });
  return queue;
}

function facturaImportacionGuardarCola(queue, properties) {
  var props = properties || PropertiesService.getScriptProperties();
  if (!Array.isArray(queue) || queue.length > FACTURA_IMPORTACION_MAX_COLA || !queue.every(facturaImportacionValidarItemCola)) {
    throw errorFacturaImportacion('COLA_REINTENTO_LLENA');
  }
  if (queue.length === 0) {
    props.deleteProperty(FACTURA_IMPORTACION_PROPIEDAD_COLA);
    return;
  }
  var json = JSON.stringify(queue);
  if (json.length > FACTURA_IMPORTACION_MAX_JSON_COLA) throw errorFacturaImportacion('COLA_REINTENTO_LLENA');
  props.setProperty(FACTURA_IMPORTACION_PROPIEDAD_COLA, json);
}

function facturaImportacionActualizarItemCola(queue, item) {
  var identity = facturaImportacionIdentidadCola(item.messageId, item.sha256Xml);
  var index = queue.findIndex(function (existing) {
    return facturaImportacionIdentidadCola(existing.messageId, existing.sha256Xml) === identity;
  });
  if (index < 0) {
    if (queue.length >= FACTURA_IMPORTACION_MAX_COLA) throw errorFacturaImportacion('COLA_REINTENTO_LLENA');
    queue.push(item);
  } else {
    queue[index] = item;
  }
}

function facturaImportacionEliminarItemCola(queue, messageId, sha256Xml) {
  var identity = facturaImportacionIdentidadCola(messageId, sha256Xml);
  return queue.filter(function (item) {
    return facturaImportacionIdentidadCola(item.messageId, item.sha256Xml) !== identity;
  });
}
