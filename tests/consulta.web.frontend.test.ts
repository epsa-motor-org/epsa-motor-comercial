import { test } from 'node:test';
import assert from 'node:assert/strict';
// JS público compartido con el formulario real; no depende de React para validar.
import { erroresConsultaWeb, normalizarCelular, intentoConsulta } from '../frontend/src/servicios/consultaWeb.js';
import { registrarConsultaWeb } from '../frontend/src/servicios/consultas.js';

const valido = { nombre:'PRUEBA QA CODEX',telefono:'987654321',sede:'Comas',tipo:'consulta',modelo:'',mensaje:'¿Horario?',acepta:true };
test('HU011 frontend: general sin modelo y cotización sin techo/comentario',()=>{
  assert.deepEqual(erroresConsultaWeb(valido),{});
  assert.deepEqual(erroresConsultaWeb({...valido,tipo:'cotizar',modelo:'1',mensaje:''}),{});
  assert.ok(erroresConsultaWeb({...valido,tipo:'cotizar'}).modelo);
  assert.ok(erroresConsultaWeb({...valido,mensaje:' \n '}).mensaje);
  assert.deepEqual(erroresConsultaWeb({...valido,mensaje:'¿'}),{});
});
test('HU011 frontend: límites 500/501 y nombres reales sin truncar',()=>{
  assert.deepEqual(erroresConsultaWeb({...valido,nombre:"Ana-María O'Neill",mensaje:'a'.repeat(500)}),{});
  assert.ok(erroresConsultaWeb({...valido,mensaje:'a'.repeat(501)}).mensaje);
  for(const nombre of ['Ál','Á'.repeat(150),'Jose\u0301 D’Ávila']) assert.equal(erroresConsultaWeb({...valido,nombre}).nombre,undefined);
  for(const nombre of ['A','A'.repeat(151),'1234','Ana\nPérez']) assert.ok(erroresConsultaWeb({...valido,nombre}).nombre);
  assert.ok(erroresConsultaWeb({...valido,acepta:false}).acepta);
});
test('HU011 frontend: normaliza prefijos y rechaza prefijos contradictorios/letras',()=>{
  for(const telefono of ['987654321','+51 (987) 654-321','51 987.654.321']) assert.equal(normalizarCelular(telefono),'987654321');
  for(const telefono of ['+987654321','+52 987654321','519876543210','987abc321','123456789','0987654321']) assert.equal(normalizarCelular(telefono),null);
});
test('HU011 frontend: mismo intento mantiene clave, un envío nuevo no se mezcla por teléfono',()=>{
  const a=intentoConsulta(null,valido,()=> 'clave-a');
  assert.equal(intentoConsulta(a,{...valido},()=> 'clave-b'),a);
  assert.equal(intentoConsulta(a,{...valido,mensaje:'Nueva consulta'},()=> 'clave-b').id,'clave-b');
  assert.equal(intentoConsulta(null,valido,()=> 'clave-c').id,'clave-c');
});
test('HU011 demo: un lead sin asignar, sin crear ventas ni seguimientos',()=>{
  const cambios:any[]=[];
  registrarConsultaWeb({leads:[],agregar:(...args:any[])=>cambios.push(args)}, {...valido,tipo:'cotizar',modelo:{id:1},acepta:true});
  assert.equal(cambios.length,1); assert.equal(cambios[0][0],'leads');
  assert.equal(cambios[0][1].responsable,'Sin asignar');
});
