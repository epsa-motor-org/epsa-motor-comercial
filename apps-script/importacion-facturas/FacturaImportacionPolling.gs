function facturaImportacionLog(evento) {
  var labelsPermitidas = function (values) {
    if (!Array.isArray(values)) return null;
    return values.slice(0, 4).filter(function (name) {
      return typeof name === 'string' && name.length <= 120 && name.trim() === name && !/[\r\n\u0000-\u001f]/.test(name);
    });
  };
  var safe = {
    evento: /^[A-Z0-9_]{1,64}$/.test(String(evento.evento || '')) ? evento.evento : 'EVENTO',
    messageId: typeof evento.messageId === 'string' ? evento.messageId.slice(0, 250) : null,
    xmlSha256: typeof evento.xmlSha256 === 'string' && /^[0-9a-f]{64}$/.test(evento.xmlSha256)
      ? evento.xmlSha256.slice(0, 12) : null,
    status: Number.isInteger(evento.status) ? evento.status : null,
    code: typeof evento.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(evento.code) ? evento.code : null,
    codrec: typeof evento.codrec === 'string' && /^[0-9a-f-]{36}$/.test(evento.codrec) ? evento.codrec : null,
    coddoc: typeof evento.coddoc === 'string' && /^\d{1,20}$/.test(evento.coddoc) ? evento.coddoc : null,
    intento: Number.isInteger(evento.intento) ? evento.intento : null,
    duracionMs: Number.isFinite(evento.duracionMs) ? Math.max(0, Math.round(evento.duracionMs)) : null,
    threadId: typeof evento.threadId === 'string' && /^[\x21-\x7e]{1,250}$/.test(evento.threadId) ? evento.threadId : null,
    estadoThread: ['Procesado', 'Pendiente', 'Revision', 'Error'].indexOf(evento.estadoThread) !== -1
      ? evento.estadoThread : null,
    estadoAutenticacion: ['AUTORIZADO', 'EXCLUIDO', 'REVISION'].indexOf(evento.estadoAutenticacion) !== -1
      ? evento.estadoAutenticacion : null,
    labelObjetivo: labelsPermitidas([evento.labelObjetivo])[0] || null,
    labelsAntes: labelsPermitidas(evento.labelsAntes),
    labelsDespues: labelsPermitidas(evento.labelsDespues),
    labelConfirmada: typeof evento.labelConfirmada === 'boolean' ? evento.labelConfirmada : null
  };
  Logger.log(JSON.stringify(safe));
}

function facturaImportacionEstadoHttp(response, retryCount, nowMs, pairingReview) {
  var parsed = facturaImportacionParsearRespuesta(response);
  var outcome = facturaImportacionClasificarRespuesta(parsed.status, parsed.code, retryCount, nowMs);
  if ((parsed.status === 200 || parsed.status === 201) && parsed.pdfPending) {
    outcome.state = 'Pendiente';
  }
  if (pairingReview && (parsed.status === 200 || parsed.status === 201)) outcome.state = 'Revision';
  return { parsed: parsed, outcome: outcome };
}

function facturaImportacionEnviarPar(config, messageId, xml, pdf, queue, retryCount, pairingReview, startedAt) {
  var shaXml;
  var request;
  try {
    request = facturaImportacionConstruirSolicitud(config, messageId, xml, pdf, Date.now());
    shaXml = request.sha256Xml;
  } catch (error) {
    var localCode = error && /^[A-Z0-9_]{1,80}$/.test(error.facturaImportacionCode || '') ? error.facturaImportacionCode : 'SOLICITUD_LOCAL_INVALIDA';
    try { shaXml = sha256Hex(facturaImportacionBytesDeBlob(xml)); } catch (_hashError) { shaXml = null; }
    if (shaXml) facturaImportacionAplicarResultadoCola(queue, messageId, shaXml, { retry: false }, Date.now());
    facturaImportacionLog({ evento: 'SOLICITUD_LOCAL_INVALIDA', messageId: messageId, xmlSha256: shaXml,
      status: 0, code: localCode, intento: retryCount + 1, duracionMs: Date.now() - startedAt });
    return { state: 'Revision', sha256Xml: shaXml, status: 0, code: localCode };
  }
  try {
    var response = UrlFetchApp.fetch(config.endpoint, {
      method: 'post',
      headers: request.headers,
      payload: request.payload,
      muteHttpExceptions: true
    });
    var result = facturaImportacionEstadoHttp(response, retryCount, Date.now(), pairingReview);
    if (result.outcome.globalStop) {
      facturaImportacionLog({ evento: 'AUTENTICACION_GLOBAL', messageId: messageId, xmlSha256: shaXml,
        status: result.parsed.status, code: result.parsed.code, intento: retryCount + 1,
        duracionMs: Date.now() - startedAt });
      return { state: 'Error', globalStop: true, sha256Xml: shaXml, status: result.parsed.status,
        code: result.parsed.code, codrec: result.parsed.codrec, coddoc: result.parsed.coddoc };
    }
    facturaImportacionAplicarResultadoCola(queue, messageId, shaXml, result.outcome, Date.now());
    facturaImportacionLog({ evento: result.outcome.state.toUpperCase(), messageId: messageId, xmlSha256: shaXml,
      status: result.parsed.status, code: result.parsed.code, codrec: result.parsed.codrec,
      coddoc: result.parsed.coddoc, intento: result.outcome.retryCount + 1,
      duracionMs: Date.now() - startedAt });
    return { state: result.outcome.state, sha256Xml: shaXml, status: result.parsed.status,
      code: result.parsed.code, codrec: result.parsed.codrec, coddoc: result.parsed.coddoc };
  } catch (error) {
    // Apps Script no entrega un status HTTP cuando fetch lanza; solo esta condición es reintentable.
    var errorCode = 'ERROR_TRANSPORTE';
    var transportOutcome = facturaImportacionClasificarRespuesta(0, '', retryCount, Date.now());
    facturaImportacionAplicarResultadoCola(queue, messageId, shaXml, transportOutcome, Date.now());
    facturaImportacionLog({ evento: transportOutcome.state.toUpperCase(), messageId: messageId, xmlSha256: shaXml,
      status: 0, code: errorCode, intento: transportOutcome.retryCount + 1,
      duracionMs: Date.now() - startedAt });
    return { state: transportOutcome.state, sha256Xml: shaXml, status: 0, code: errorCode };
  }
}

function facturaImportacionAplicarResultadoCola(queue, messageId, shaXml, outcome, nowMs) {
  if (!shaXml) return;
  if (outcome.retry) {
    facturaImportacionActualizarItemCola(queue, {
      messageId: messageId,
      sha256Xml: shaXml,
      retryCount: outcome.retryCount,
      nextAttemptAt: outcome.nextAttemptAt
    });
  } else {
    var remaining = facturaImportacionEliminarItemCola(queue, messageId, shaXml);
    queue.splice(0, queue.length);
    remaining.forEach(function (item) { queue.push(item); });
  }
  facturaImportacionGuardarCola(queue);
  return queue;
}

function facturaImportacionAgregarEstadoThread(states, thread, state, labels) {
  var id = thread.getId();
  if (!states[id]) {
    states[id] = { thread: thread, states: [] };
    var existing = thread.getLabels ? thread.getLabels() : [];
    existing.forEach(function (label) {
      Object.keys(labels || {}).forEach(function (priorState) {
        if (priorState !== 'Procesado' && label.getName() === labels[priorState])
          states[id].states.push(priorState);
      });
    });
  }
  if (state) states[id].states.push(state);
}

function facturaImportacionEstadoThreadAgregado(values) {
  var states = values || [];
  if (states.indexOf('Revision') !== -1) return 'Revision';
  if (states.indexOf('Error') !== -1) return 'Error';
  if (states.indexOf('Pendiente') !== -1) return 'Pendiente';
  if (states.length > 0 && states.every(function (state) { return state === 'Procesado'; })) return 'Procesado';
  return null;
}

function facturaImportacionLabelsGestionadasThread(thread, labels) {
  var managed = Object.keys(labels || {}).map(function (state) { return labels[state]; });
  var existing = thread.getLabels ? thread.getLabels() : [];
  return existing.map(function (label) { return label.getName(); })
    .filter(function (name) { return managed.indexOf(name) !== -1; })
    .sort();
}

function facturaImportacionAplicarLabelThread(thread, state, labels) {
  if (!state || !labels || !labels[state]) {
    var unchanged = facturaImportacionLabelsGestionadasThread(thread, labels);
    facturaImportacionLog({
      evento: 'LABEL_THREAD_OMITIDA',
      threadId: thread.getId(),
      estadoThread: state,
      labelObjetivo: state && labels ? labels[state] : null,
      labelsAntes: unchanged,
      labelsDespues: unchanged,
      labelConfirmada: false
    });
    return;
  }
  var before = facturaImportacionLabelsGestionadasThread(thread, labels);
  var allLabels = Object.keys(labels).map(function (key) {
    var name = labels[key];
    return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  });
  allLabels.forEach(function (label) {
    if (label.getName() !== labels[state]) thread.removeLabel(label);
  });
  var selected = allLabels.filter(function (label) { return label.getName() === labels[state]; })[0];
  if (selected) thread.addLabel(selected);
  try { if (typeof thread.refresh === 'function') thread.refresh(); } catch (_refreshError) { /* se confirma leyendo el estado disponible */ }
  var after = facturaImportacionLabelsGestionadasThread(thread, labels);
  var confirmed = after.indexOf(labels[state]) !== -1;
  facturaImportacionLog({
    evento: confirmed ? 'LABEL_THREAD_APLICADA' : 'LABEL_THREAD_NO_CONFIRMADA',
    threadId: thread.getId(),
    estadoThread: state,
    labelObjetivo: labels[state],
    labelsAntes: before,
    labelsDespues: after,
    labelConfirmada: confirmed
  });
}

function facturaImportacionClasificarAttachmentsMensaje(message) {
  var attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  return facturaImportacionClasificarAdjuntos(attachments);
}

function facturaImportacionRegistrarAutenticacion(messageId, result) {
  facturaImportacionLog({
    evento: 'AUTENTICACION_CORREO',
    messageId: messageId,
    estadoAutenticacion: result && result.estado,
    code: result && result.motivo
  });
}

function facturaImportacionProcesarMensaje(config, message, queue, states, attempted) {
  var messageId = message.getId();
  var thread = message.getThread();
  var authentication = facturaImportacionAutenticarMensaje(config, message);
  facturaImportacionRegistrarAutenticacion(messageId, authentication);
  if (!authentication.autorizado) {
    if (authentication.estado === 'REVISION') facturaImportacionAgregarEstadoThread(states, thread, 'Revision', config.labels);
    return { globalStop: false, handled: 0, excluded: authentication.estado === 'EXCLUIDO' };
  }
  if (attempted[messageId + '|*']) return { globalStop: false, handled: 0 };
  var classified = facturaImportacionClasificarAttachmentsMensaje(message);
  if (classified.xml.length === 0) {
    if (classified.pdf.length > 0 || classified.ambiguous.length > 0) {
      facturaImportacionAgregarEstadoThread(states, thread, 'Revision', config.labels);
      facturaImportacionLog({ evento: classified.pdf.length > 0 ? 'PDF_SIN_XML' : 'ADJUNTO_AMBIGUO', messageId: messageId });
    }
    return { globalStop: false, handled: 0 };
  }
  if (classified.ambiguous.length > 0) facturaImportacionAgregarEstadoThread(states, thread, 'Revision', config.labels);
  var pairing = emparejarXmlPdfFacturaImportacion(classified.xml, classified.pdf);
  if (pairing.review) facturaImportacionAgregarEstadoThread(states, thread, 'Revision', config.labels);
  var handled = 0;
  for (var index = 0; index < pairing.pairs.length; index += 1) {
    var pair = pairing.pairs[index];
    var pairHash;
    try {
      if (facturaImportacionBytesDeBlob(pair.xml.blob).length > FACTURA_IMPORTACION_MAX_XML_BYTES) {
        facturaImportacionAgregarEstadoThread(states, thread, 'Revision', config.labels);
        facturaImportacionLog({ evento: 'XML_DEMASIADO_GRANDE', messageId: messageId });
        continue;
      }
      pairHash = sha256Hex(facturaImportacionBytesDeBlob(pair.xml.blob));
    }
    catch (_error) { facturaImportacionAgregarEstadoThread(states, thread, 'Revision', config.labels); continue; }
    var identity = facturaImportacionIdentidadCola(messageId, pairHash);
    if (attempted[identity]) continue;
    attempted[identity] = true;
    var result = facturaImportacionEnviarPar(config, messageId, pair.xml.blob, pair.pdf && pair.pdf.blob,
      queue, 0, pair.review, Date.now());
    facturaImportacionAgregarEstadoThread(states, thread, result.state, config.labels);
    handled += 1;
    if (result.globalStop) return { globalStop: true, handled: handled };
  }
  return { globalStop: false, handled: handled };
}

function facturaImportacionBuscarThreads(query, maxThreads, alreadyCounted) {
  var pageSize = 100;
  var start = 0;
  var threads = [];
  var seen = {};
  Object.keys(alreadyCounted || {}).forEach(function (id) { seen[id] = true; });
  var truncated = false;
  while (threads.length <= maxThreads) {
    var page = GmailApp.search(query, start, pageSize);
    if (!page || page.length === 0) break;
    for (var index = 0; index < page.length; index += 1) {
      var id = page[index].getId();
      if (!seen[id]) {
        seen[id] = true;
        threads.push(page[index]);
        if (threads.length > maxThreads) {
          truncated = true;
          break;
        }
      }
    }
    if (truncated || page.length < pageSize) break;
    start += page.length;
  }
  return { threads: threads.slice(0, maxThreads), truncated: truncated };
}

function facturaImportacionReemplazarCola(queue, remaining) {
  queue.splice(0, queue.length);
  remaining.forEach(function (item) { queue.push(item); });
  facturaImportacionGuardarCola(queue);
}

function facturaImportacionRecuperarRetry(item, config, queue, states, attempted, nowMs) {
  var message;
  try { message = GmailApp.getMessageById(item.messageId); }
  catch (_error) { message = null; }
  var thread = message && message.getThread ? message.getThread() : null;
  if (!message) {
    facturaImportacionReemplazarCola(queue, facturaImportacionEliminarItemCola(queue, item.messageId, item.sha256Xml));
    attempted[item.messageId + '|*'] = true;
    facturaImportacionLog({ evento: 'RETRY_MENSAJE_NO_DISPONIBLE', messageId: item.messageId, xmlSha256: item.sha256Xml });
    return { state: 'Revision', thread: thread };
  }
  var authentication = facturaImportacionAutenticarMensaje(config, message);
  facturaImportacionRegistrarAutenticacion(item.messageId, authentication);
  if (!authentication.autorizado) {
    facturaImportacionReemplazarCola(queue, facturaImportacionEliminarItemCola(queue, item.messageId, item.sha256Xml));
    attempted[item.messageId + '|*'] = true;
    return { state: authentication.estado === 'REVISION' ? 'Revision' : null, thread: thread };
  }
  var classified = facturaImportacionClasificarAttachmentsMensaje(message);
  var matching = classified.xml.filter(function (entry) {
    try { return sha256Hex(facturaImportacionBytesDeBlob(entry.blob)) === item.sha256Xml; }
    catch (_error) { return false; }
  });
  if (matching.length !== 1) {
    facturaImportacionReemplazarCola(queue, facturaImportacionEliminarItemCola(queue, item.messageId, item.sha256Xml));
    attempted[item.messageId + '|*'] = true;
    facturaImportacionLog({ evento: 'RETRY_XML_NO_UNIVOCO', messageId: item.messageId, xmlSha256: item.sha256Xml });
    return { state: 'Revision', thread: thread };
  }
  var pairing = emparejarXmlPdfFacturaImportacion(classified.xml, classified.pdf);
  var pair = pairing.pairs.filter(function (entry) {
    try { return sha256Hex(facturaImportacionBytesDeBlob(entry.xml.blob)) === item.sha256Xml; }
    catch (_error) { return false; }
  })[0];
  if (!pair) {
    facturaImportacionReemplazarCola(queue, facturaImportacionEliminarItemCola(queue, item.messageId, item.sha256Xml));
    attempted[item.messageId + '|*'] = true;
    return { state: 'Revision', thread: thread };
  }
  var identity = facturaImportacionIdentidadCola(item.messageId, item.sha256Xml);
  attempted[identity] = true;
  var result = facturaImportacionEnviarPar(config, item.messageId, pair.xml.blob, pair.pdf && pair.pdf.blob,
    queue, item.retryCount, pair.review, nowMs);
  return { state: result.state, thread: thread, globalStop: result.globalStop, identity: identity };
}

function facturaImportacionProcesarRetries(config, queue, states, attempted, maxThreads) {
  var now = Date.now();
  var due = queue.filter(function (item) { return parsearIsoFacturaImportacion(item.nextAttemptAt) <= now; })
    .sort(function (left, right) { return parsearIsoFacturaImportacion(left.nextAttemptAt) - parsearIsoFacturaImportacion(right.nextAttemptAt); });
  var usedThreads = {};
  var globalStop = false;
  var incomplete = due.length > maxThreads;
  for (var index = 0; index < due.length && Object.keys(usedThreads).length < maxThreads; index += 1) {
    var item = due[index];
    var retryResult = facturaImportacionRecuperarRetry(item, config, queue, states, attempted, now);
    if (retryResult.thread) {
      usedThreads[retryResult.thread.getId()] = true;
      facturaImportacionAgregarEstadoThread(states, retryResult.thread, retryResult.state, config.labels);
    }
    if (retryResult.globalStop) { globalStop = true; incomplete = true; break; }
  }
  return { usedThreads: usedThreads, globalStop: globalStop, incomplete: incomplete };
}

function procesarCorreosPendientes() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  var shouldAdvance = false;
  try {
    var config = facturaImportacionLeerConfiguracion();
    var now = Date.now();
    var window = facturaImportacionVentanaBarrido(config, now);
    var queue = facturaImportacionCargarCola();
    var states = {};
    var attempted = {};
    var retryRun = facturaImportacionProcesarRetries(config, queue, states, attempted, config.batchMax);
    var used = retryRun.usedThreads;
    var incomplete = retryRun.incomplete;
    var failed = false;
    var globalStop = retryRun.globalStop;
    var capacity = Math.max(0, config.batchMax - Object.keys(used).length);
    if (capacity === 0) incomplete = true;
    if (!globalStop && capacity > 0) {
      var found = facturaImportacionBuscarThreads(window.gmailQuery, capacity, used);
      incomplete = incomplete || found.truncated;
      for (var threadIndex = 0; threadIndex < found.threads.length; threadIndex += 1) {
        var thread = found.threads[threadIndex];
        used[thread.getId()] = true;
        var messages = thread.getMessages();
        for (var messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
          var message = messages[messageIndex];
          if (!facturaImportacionFechaEnVentana(message.getDate(), window)) continue;
          var result;
          try { result = facturaImportacionProcesarMensaje(config, message, queue, states, attempted); }
          catch (_messageError) {
            failed = true;
            facturaImportacionAgregarEstadoThread(states, thread, 'Error', config.labels);
            facturaImportacionLog({ evento: 'ERROR_PROCESANDO_MENSAJE', messageId: message.getId() });
            continue;
          }
          if (result.globalStop) { globalStop = true; incomplete = true; break; }
        }
        if (globalStop) break;
      }
    }
    Object.keys(states).forEach(function (threadId) {
      var entry = states[threadId];
      var aggregateState = facturaImportacionEstadoThreadAgregado(entry.states);
      facturaImportacionAplicarLabelThread(entry.thread, aggregateState, config.labels);
    });
    shouldAdvance = !incomplete && !failed && !globalStop;
    if (shouldAdvance) facturaImportacionGuardarUltimoBarrido(PropertiesService.getScriptProperties(), now);
    if (!shouldAdvance) facturaImportacionLog({ evento: globalStop ? 'BARRIDO_DETENIDO' : 'BARRIDO_PARCIAL' });
  } catch (error) {
    var code = error && /^[A-Z0-9_]{1,80}$/.test(error.facturaImportacionCode || '') ? error.facturaImportacionCode : 'EJECUCION_FALLIDA';
    facturaImportacionLog({ evento: code });
  } finally {
    lock.releaseLock();
  }
}
