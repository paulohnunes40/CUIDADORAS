// Testa a lógica clínica de js/app.js com um DOM mínimo simulado.
const fs = require('fs'), vm = require('vm');

const elementos = {};
function elem(id){
  if(!elementos[id]) elementos[id] = {
    id, value:'', innerText:'', innerHTML:'', checked:false, hidden:true, className:'',
    style:{}, dataset:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    addEventListener(){}, setAttribute(){}, appendChild(){}, querySelector(){return null;},
    querySelectorAll(){return [];}, closest(){ return elem(id+':pai'); }, focus(){}, scrollIntoView(){}
  };
  return elementos[id];
}
const doc = {
  getElementById: elem,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => elem('novo'),
  addEventListener: () => {}
};
const contexto = {
  document: doc,
  window: { addEventListener(){}, scrollTo(){}, DB:null },
  localStorage: { dados:{}, getItem(k){return this.dados[k]||null;}, setItem(k,v){this.dados[k]=v;}, removeItem(k){delete this.dados[k];} },
  navigator: {}, console, setTimeout, Date, Math, JSON, Number, String, Array, Set, Map, RegExp, Promise, isNaN
};
contexto.window.localStorage = contexto.localStorage;
vm.createContext(contexto);

const fonte = fs.readFileSync('js/app.js', 'utf8').replace(/^'use strict';/, '');
vm.runInContext(fonte + '\n;globalThis.__api = { classificarGlicemia, estatisticasGlicemia, montarTexto, periodoDoHorario, minutosDoHorario, turnoPorHora, indiceTurno, isoParaBR, isoDoRegistro, dataParaIso, parseDataBR, escaparHtml, mediaDoDia };', contexto);
const api = contexto.__api;

let ok = 0, falhas = 0;
function checar(nome, real, esperado){
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if(a === b){ ok++; console.log('  ok   ' + nome); }
  else { falhas++; console.log('  FALHA ' + nome + '\n        esperado: ' + b + '\n        obtido:   ' + a); }
}

console.log('\n— Classificação de glicemia —');
checar('50 = hipoglicemia grave (perigo)', api.classificarGlicemia(50).nivel, 'perigo');
checar('65 = hipoglicemia (perigo)',       api.classificarGlicemia(65).nivel, 'perigo');
checar('69 ainda é hipo',                  api.classificarGlicemia(69).nivel, 'perigo');
checar('70 já é faixa alvo',               api.classificarGlicemia(70).nivel, 'ok');
checar('120 na faixa alvo',                api.classificarGlicemia(120).nivel, 'ok');
checar('180 ainda na faixa',               api.classificarGlicemia(180).nivel, 'ok');
checar('190 acima da faixa (atenção)',     api.classificarGlicemia(190).nivel, 'atencao');
checar('300 hiper importante (atenção)',   api.classificarGlicemia(300).nivel, 'atencao');
checar('450 crítico (perigo)',             api.classificarGlicemia(450).nivel, 'perigo');
checar('vazio não classifica',             api.classificarGlicemia(''), null);
checar('zero não classifica',              api.classificarGlicemia(0), null);

console.log('\n— Estatísticas do mês —');
const mes = [
  { dia:'01', cafe:{glicemia:'100'}, almoco:{glicemia:'200'}, janta:{glicemia:'150'} },
  { dia:'02', cafe:{glicemia:'60'},  almoco:{glicemia:''},    janta:{glicemia:'140'} }
];
const st = api.estatisticasGlicemia(mes);
checar('n de medições', st.n, 5);
checar('média',   st.media, Math.round((100+200+150+60+140)/5));
checar('mínima',  st.min, 60);
checar('máxima',  st.max, 200);
checar('hipos',   st.hipos, 1);
checar('% fora da faixa (60 e 200)', st.percentualFora, 40);
checar('mês vazio devolve null', api.estatisticasGlicemia([]), null);
checar('média do dia 1', api.mediaDoDia(mes[0]), 150);

console.log('\n— Datas e turnos —');
checar('turno às 7h', api.turnoPorHora(7), 'Manhã');
checar('turno às 13h', api.turnoPorHora(13), 'Tarde');
checar('turno às 22h', api.turnoPorHora(22), 'Noite');
checar('turno às 3h (madrugada)', api.turnoPorHora(3), 'Noite');
checar('índice do turno Tarde', api.indiceTurno('Tarde'), 1);
checar('ISO para BR', api.isoParaBR('2026-08-08'), '08/08/2026');
checar('data para ISO', api.dataParaIso(new Date(2026, 7, 8)), '2026-08-08');
checar('registro antigo sem dataIso', api.isoDoRegistro({ dataFormatada:'05/03/2026' }), '2026-03-05');
checar('registro novo com dataIso', api.isoDoRegistro({ dataIso:'2026-03-05', dataFormatada:'x' }), '2026-03-05');
checar('período 03:00', api.periodoDoHorario('03:00'), 'madrugada');
checar('período 14:30', api.periodoDoHorario('14:30'), 'tarde');
checar('minutos 14:30', api.minutosDoHorario('14:30'), 870);

console.log('\n— Escape de HTML (chips digitados pela cuidadora) —');
checar('tag é neutralizada', api.escaparHtml('<img onerror=x>'), '&lt;img onerror=x&gt;');

console.log('\n— Montagem do texto da evolução —');
const dados = {
  estados:['consciente','febril'], usoFralda:true,
  diurese:'Diurese presente em fralda', evacuacao:'Sem evacuação',
  medicacoes:['Puran (jejum)'], dieta:'sopa de legumes',
  horarios:['08:00','12:00'], higieneDetalhes:'banho de leito',
  obs:'Sem intercorrências.', cuidadora:'Edna', repasse:'Camila'
};
const texto = api.montarTexto(dados, 'Controle Glicêmico (Café da manhã)\nGlicemia: 110 mg/dL', ['Sem evacuação há 3 plantões seguidos.']);
const contem = t => texto.includes(t);
checar('inclui estados', contem('Paciente acamada, consciente, febril'), true);
checar('inclui uso de fralda', contem('Em uso de fralda'), true);
checar('inclui glicemia', contem('Glicemia: 110 mg/dL'), true);
checar('inclui medicação', contem('Puran (jejum)'), true);
checar('inclui dieta', contem('sopa de legumes'), true);
checar('inclui horários com período', contem('08:00 · manhã'), true);
checar('inclui pontos de atenção', contem('Pontos de atenção'), true);
checar('inclui a observação automática', contem('• Sem evacuação há 3 plantões seguidos.'), true);
checar('inclui repasse', contem('Repasse do plantão para Camila.'), true);
checar('assina com a cuidadora', texto.trim().endsWith('Atenciosamente,\nEdna'), true);
checar('sem 3 quebras de linha seguidas', /\n{3,}/.test(texto), false);

const semNada = api.montarTexto(
  { estados:[], usoFralda:false, diurese:'Diurese ausente', evacuacao:'Evacuação em vaso',
    medicacoes:[], dieta:'', horarios:[], higieneDetalhes:'', obs:'', cuidadora:'Kauane', repasse:'' },
  '', []);
checar('relatório mínimo não quebra', semNada.includes('Paciente acamada.'), true);
checar('sem repasse não escreve repasse', semNada.includes('Repasse'), false);

console.log(`\n=========================\n${ok} passaram, ${falhas} falharam\n=========================`);
process.exit(falhas ? 1 : 0);
