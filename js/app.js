/* =========================================================================
   App de Evolução — lógica da interface.
   Depende de js/dados.js (window.DB) e do html2canvas.
   ========================================================================= */
'use strict';

/* ---------------------------------------------------------------------
   1. CONSTANTES
   --------------------------------------------------------------------- */
const CUIDADORAS = ['Edna', 'Camila', 'Kauane'];

const TURNOS = [
  { nome: 'Manhã', refeicao: 'cafe',   rotuloRefeicao: 'Café da manhã', inicio: 6,  fim: 12 },
  { nome: 'Tarde', refeicao: 'almoco', rotuloRefeicao: 'Almoço',        inicio: 12, fim: 18 },
  { nome: 'Noite', refeicao: 'janta',  rotuloRefeicao: 'Janta',         inicio: 18, fim: 6  }
];

// Faixas de referência para glicemia capilar (mg/dL).
const GLICEMIA = { hipoGrave: 54, hipo: 70, alvoMax: 180, alta: 250, critica: 400 };

// Intervalo máximo recomendado entre mudanças de decúbito / trocas (horas).
const INTERVALO_DECUBITO_H = 3;

const CHAVE_RASCUNHO = 'evolucao:rascunho:v1';
const CHAVE_CUIDADORA = 'evolucao:cuidadora';
const PAGINA_HISTORICO = 40;

/* ---------------------------------------------------------------------
   2. UTILITÁRIOS
   --------------------------------------------------------------------- */
const $ = id => document.getElementById(id);

function escaparHtml(txt){
  return String(txt).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function aviso(texto, tipo){
  const cont = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + (tipo || '');
  el.setAttribute('role', 'status');
  el.innerText = texto;
  cont.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 6000 : 3800);
}

function formatarDataBR(d){
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
}

function parseDataBR(str){
  if(!str) return null;
  const partes = String(str).split('/');
  if(partes.length !== 3) return null;
  const [dia, mes, ano] = partes;
  const d = new Date(Number(ano), Number(mes) - 1, Number(dia));
  return isNaN(d) ? null : d;
}

function isoParaData(iso){
  if(!iso) return null;
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  return isNaN(dt) ? null : dt;
}

function dataParaIso(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Aceita registros antigos que só guardavam dd/mm/aaaa.
function isoDoRegistro(r){
  if(r.dataIso) return r.dataIso;
  const d = parseDataBR(r.dataFormatada);
  return d ? dataParaIso(d) : '';
}

function isoParaBR(iso){
  return iso ? iso.split('-').reverse().join('/') : '';
}

function capitalizar(txt){
  return String(txt).charAt(0).toUpperCase() + String(txt).slice(1);
}

function minutosDoHorario(hhmm){
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

function periodoDoHorario(hhmm){
  const h = parseInt(String(hhmm).split(':')[0], 10);
  if(h < 6) return 'madrugada';
  if(h < 12) return 'manhã';
  if(h < 18) return 'tarde';
  return 'noite';
}

function turnoPorHora(hora){
  if(hora >= 6 && hora < 12) return 'Manhã';
  if(hora >= 12 && hora < 18) return 'Tarde';
  return 'Noite';
}

function indiceTurno(nome){
  return TURNOS.findIndex(t => t.nome === nome);
}

/* ---------------------------------------------------------------------
   3. ESTADO
   --------------------------------------------------------------------- */
const hoje = new Date();
let saudacaoTexto = 'Boa noite';
let turnoAtual = 'Noite';
let horarios = [];
let textoParaCompartilhar = '';
let cacheHistorico = [];
let limiteHistorico = PAGINA_HISTORICO;
let cancelarEscuta = null;
let edicaoId = null;          // id do registro em edição (null = novo)
let restaurandoRascunho = false;

/* ---------------------------------------------------------------------
   4. INICIALIZAÇÃO
   --------------------------------------------------------------------- */
function preencherSelectCuidadoras(select, incluirTodas){
  select.innerHTML = (incluirTodas ? '<option value="">Todas</option>' : '') +
    CUIDADORAS.map(n => `<option value="${escaparHtml(n)}">${escaparHtml(n)}</option>`).join('');
}

function iniciar(){
  // Lê o rascunho ANTES de qualquer coisa: a montagem da tela dispara
  // salvamentos automáticos que sobrescreveriam o que estava guardado.
  let rascunhoSalvo = null;
  try{ rascunhoSalvo = localStorage.getItem(CHAVE_RASCUNHO); }catch(e){ /* bloqueado */ }

  $('dataAtual').valueAsDate = hoje;
  $('dataGlicemia').valueAsDate = hoje;
  $('mesGlicemia').value = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
  $('dataLegivel').innerText = hoje.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' });

  const hora = hoje.getHours();
  if(hora >= 5 && hora < 12) saudacaoTexto = 'Bom dia';
  else if(hora >= 12 && hora < 18) saudacaoTexto = 'Boa tarde';
  $('saudacao').innerText = saudacaoTexto;

  preencherSelectCuidadoras($('cuidadora'), false);
  preencherSelectCuidadoras($('filtroCuidadora'), true);
  const lembrada = localStorage.getItem(CHAVE_CUIDADORA);
  if(lembrada && CUIDADORAS.includes(lembrada)) $('cuidadora').value = lembrada;
  popularRepasse();

  const turnoInicial = turnoPorHora(hora);
  selecionarTurno(turnoInicial, indiceTurno(turnoInicial));

  renderHorarios();
  atualizarContadores();
  registrarAutoSalvamento();
  restaurarRascunho(rascunhoSalvo);
  conectarHistorico();

  $('cuidadora').addEventListener('change', () => {
    localStorage.setItem(CHAVE_CUIDADORA, $('cuidadora').value);
    popularRepasse();
  });
  $('dataAtual').addEventListener('change', () => {
    marcarTurnosRegistrados();
    avaliarPendencia();
  });

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW não registrado:', e));
  }
}

/* ---------------------------------------------------------------------
   5. NAVEGAÇÃO ENTRE TELAS
   --------------------------------------------------------------------- */
function mudarTela(tela){
  const telas = { historico:'telaHistorico', evolucao:'telaEvolucao', glicemia:'telaGlicemia' };
  const tabs  = { historico:'tabHistorico', evolucao:'tabEvolucao', glicemia:'tabGlicemia' };
  Object.keys(telas).forEach(nome => {
    const ativo = nome === tela;
    $(telas[nome]).style.display = ativo ? 'block' : 'none';
    $(tabs[nome]).classList.toggle('ativo', ativo);
    $(tabs[nome]).setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function selecionarTurno(nome, indice){
  turnoAtual = nome;
  document.querySelectorAll('.turno-btn').forEach(b => {
    const ativo = b.dataset.turno === nome;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
  const posicoes = [[40,20], [150,8], [260,20]];
  const cores = ['#F6C453', '#FFE9A8', '#C9D6E8'];
  const i = (indice === undefined || indice < 0) ? indiceTurno(nome) : indice;
  const [x, y] = posicoes[i] || posicoes[2];
  $('arcoSol').setAttribute('cx', x);
  $('arcoSol').setAttribute('cy', y);
  $('arcoSol').setAttribute('fill', cores[i] || cores[2]);
  salvarRascunho();
  avaliarPendencia();
}

/* ---------------------------------------------------------------------
   6. CAMPOS: repasse, toggles, chips, horários
   --------------------------------------------------------------------- */
function popularRepasse(){
  const atual = $('cuidadora').value;
  const select = $('repasse');
  const anterior = select.value;
  select.innerHTML = '<option value="">Selecione...</option>' +
    CUIDADORAS.filter(n => n !== atual)
      .map(n => `<option value="${escaparHtml(n)}">${escaparHtml(n)}</option>`).join('');
  if(anterior && anterior !== atual) select.value = anterior;
}

function alternarToggle(el){
  el.classList.toggle('on');
  const input = el.querySelector('input[type="checkbox"]');
  input.checked = el.classList.contains('on');
  el.setAttribute('aria-pressed', input.checked ? 'true' : 'false');
  salvarRascunho();
}

function alternarChip(el){
  el.classList.toggle('on');
  el.setAttribute('aria-pressed', el.classList.contains('on') ? 'true' : 'false');
  atualizarContadores();
  salvarRascunho();
}

// Mostra no título do cartão quantos itens estão marcados — a cuidadora
// enxerga o que já preencheu sem precisar reler a lista inteira.
function atualizarContadores(){
  [['listaEstados','contadorEstados'], ['listaMedicacoes','contadorMedicacoes']].forEach(([lista, badge]) => {
    const el = $(badge);
    if(!el) return;
    const n = $(lista).querySelectorAll('.chip.on').length;
    el.innerText = n === 1 ? '1 marcado' : n + ' marcados';
    el.hidden = n === 0;
  });
}

const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function criarChipEl(item){
  const div = document.createElement('div');
  div.className = 'chip' + (item.on ? ' on' : '') + (item.fixa ? ' chip-fixa' : '');
  div.dataset.valor = item.valor;
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');
  div.setAttribute('aria-pressed', item.on ? 'true' : 'false');
  div.innerHTML = `<div class="dot">${SVG_CHECK}</div><span class="nome">${escaparHtml(item.nome)}</span>` +
    (item.fixa ? '' : '<button type="button" class="x" aria-label="Remover">✕</button>');
  div.addEventListener('click', e => {
    if(e.target.classList.contains('x')){ e.stopPropagation(); div.remove(); atualizarContadores(); salvarRascunho(); return; }
    alternarChip(div);
  });
  div.addEventListener('keydown', e => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); alternarChip(div); }
  });
  return div;
}

function lerChips(containerId){
  return [...$(containerId).querySelectorAll('.chip')].map(c => ({
    valor: c.dataset.valor,
    nome: c.querySelector('.nome').innerText,
    on: c.classList.contains('on'),
    fixa: c.classList.contains('chip-fixa')
  }));
}

// Mantém os itens fixos atuais do app e aplica o estado salvo por cima,
// acrescentando no fim os itens avulsos que só existiam no registro antigo.
function aplicarChips(containerId, salvos){
  if(!Array.isArray(salvos)) return;
  const cont = $(containerId);
  const fixosAtuais = lerChips(containerId).filter(c => c.fixa);
  const porValor = new Map(salvos.map(s => [s.valor, s]));
  const resultado = fixosAtuais.map(f => ({ ...f, on: porValor.has(f.valor) ? !!porValor.get(f.valor).on : false }));
  const valoresFixos = new Set(fixosAtuais.map(f => f.valor));
  salvos.filter(s => !valoresFixos.has(s.valor)).forEach(s => resultado.push({ ...s, fixa: false }));
  cont.innerHTML = '';
  resultado.forEach(item => cont.appendChild(criarChipEl(item)));
  atualizarContadores();
}

function adicionarChipAvulso(inputId, containerId){
  const input = $(inputId);
  const valor = input.value.trim();
  if(!valor) return;
  const cont = $(containerId);
  const jaExiste = [...cont.querySelectorAll('.chip')]
    .find(c => c.querySelector('.nome').innerText.toLowerCase() === valor.toLowerCase());
  if(jaExiste){
    if(!jaExiste.classList.contains('on')) alternarChip(jaExiste);
    aviso('Esse item já estava na lista — marquei para você.');
  } else {
    cont.appendChild(criarChipEl({ valor, nome: valor, on: true, fixa: false }));
  }
  input.value = '';
  input.focus();
  atualizarContadores();
  salvarRascunho();
}

function adicionarEstado(){ adicionarChipAvulso('novoEstadoNome', 'listaEstados'); }
function adicionarMedicacao(){ adicionarChipAvulso('novoMedNome', 'listaMedicacoes'); }

function adicionarHorario(){
  const input = $('novoHorario');
  if(!input.value) return;
  if(horarios.includes(input.value)){
    aviso('Esse horário já foi adicionado.');
    input.value = '';
    return;
  }
  horarios.push(input.value);
  horarios.sort();
  input.value = '';
  renderHorarios();
}

function removerHorario(i){
  horarios.splice(i, 1);
  renderHorarios();
}

function renderHorarios(){
  const cont = $('listaHorarios');
  if(horarios.length === 0){
    cont.innerHTML = '<span class="vazio-aviso">Nenhum horário adicionado ainda</span>';
  } else {
    cont.innerHTML = horarios.map((h, i) =>
      `<div class="horario-chip">${escaparHtml(h)} · ${periodoDoHorario(h)}` +
      `<button type="button" class="x" aria-label="Remover ${escaparHtml(h)}" onclick="removerHorario(${i})">✕</button></div>`
    ).join('');
  }
  avaliarDecubito();
  salvarRascunho();
}

/* ---------------------------------------------------------------------
   7. INTELIGÊNCIA CLÍNICA
   --------------------------------------------------------------------- */

// Alerta quando o intervalo entre trocas/mudanças de decúbito passa do recomendado.
function avaliarDecubito(){
  const box = $('alertaDecubito');
  if(!box) return;
  if(horarios.length === 0){ box.hidden = true; return; }

  const mins = horarios.map(minutosDoHorario).sort((a,b) => a-b);
  let maiorIntervalo = 0, ondeA = null, ondeB = null;
  for(let i = 1; i < mins.length; i++){
    const dif = mins[i] - mins[i-1];
    if(dif > maiorIntervalo){ maiorIntervalo = dif; ondeA = mins[i-1]; ondeB = mins[i]; }
  }
  const fmt = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

  if(maiorIntervalo > INTERVALO_DECUBITO_H * 60){
    const horas = (maiorIntervalo/60).toFixed(1).replace('.', ',');
    box.className = 'aviso aviso-atencao';
    box.innerHTML = `<span class="ico">⚠️</span><div>Intervalo de <b>${horas}h</b> entre ${fmt(ondeA)} e ${fmt(ondeB)}. ` +
      `A mudança de decúbito é recomendada a cada ${INTERVALO_DECUBITO_H}h para prevenir lesão por pressão.</div>`;
    box.hidden = false;
  } else if(horarios.length < 2){
    box.className = 'aviso aviso-info';
    box.innerHTML = '<span class="ico">💡</span><div>Registre cada troca/mudança de decúbito do plantão — o app avisa se o intervalo passar de ' + INTERVALO_DECUBITO_H + 'h.</div>';
    box.hidden = false;
  } else {
    box.className = 'aviso aviso-ok';
    box.innerHTML = `<span class="ico">✅</span><div>${horarios.length} registros, intervalo máximo de ${(maiorIntervalo/60).toFixed(1).replace('.', ',')}h — dentro do recomendado.</div>`;
    box.hidden = false;
  }
}

function classificarGlicemia(valor){
  const v = Number(valor);
  if(!v) return null;
  if(v < GLICEMIA.hipoGrave) return { nivel:'perigo', classe:'alerta-baixa', texto:`${v} mg/dL — hipoglicemia grave. Aplique o protocolo e avise o responsável imediatamente.` };
  if(v < GLICEMIA.hipo)      return { nivel:'perigo', classe:'alerta-baixa', texto:`${v} mg/dL — hipoglicemia. Ofereça carboidrato de absorção rápida e avise o responsável.` };
  if(v >= GLICEMIA.critica)  return { nivel:'perigo', classe:'alerta-alta',  texto:`${v} mg/dL — valor muito alto. Avise o responsável/médico imediatamente.` };
  if(v >= GLICEMIA.alta)     return { nivel:'atencao', classe:'alerta-alta', texto:`${v} mg/dL — hiperglicemia importante. Confira a insulina e registre na observação.` };
  if(v > GLICEMIA.alvoMax)   return { nivel:'atencao', classe:'alerta-alta', texto:`${v} mg/dL — acima da faixa alvo (até ${GLICEMIA.alvoMax}).` };
  return { nivel:'ok', classe:'', texto:`${v} mg/dL — dentro da faixa alvo (${GLICEMIA.hipo}–${GLICEMIA.alvoMax}).` };
}

// Chamado a cada digitação nos campos de glicemia.
function avaliarGlicemiaCampo(refeicao){
  const mapa = { cafe:'Cafe', almoco:'Almoco', janta:'Janta' };
  const sufixo = mapa[refeicao];
  const input = $('glicemia' + sufixo);
  const caixa = input.closest('.vital-box');
  const box = $('alertaGlicemia' + sufixo);
  const insulina = $('insulina' + sufixo).value.trim();

  caixa.classList.remove('alerta-baixa', 'alerta-alta');
  const r = classificarGlicemia(input.value);

  if(!r){
    if(insulina){
      box.className = 'aviso aviso-atencao';
      box.innerHTML = '<span class="ico">⚠️</span><div>Insulina registrada sem o valor de glicemia correspondente.</div>';
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    return;
  }
  if(r.classe) caixa.classList.add(r.classe);
  box.className = 'aviso ' + (r.nivel === 'perigo' ? 'aviso-perigo' : r.nivel === 'atencao' ? 'aviso-atencao' : 'aviso-ok');
  box.innerHTML = `<span class="ico">${r.nivel === 'ok' ? '✅' : r.nivel === 'perigo' ? '🚨' : '⚠️'}</span><div>${escaparHtml(r.texto)}</div>`;
  box.hidden = false;
}

// Compara o plantão atual com os anteriores e devolve frases prontas.
async function gerarObservacoesAutomaticas(dataIso, dados){
  const linhas = [];

  // Datas dos últimos 3 dias (para constipação e turno anterior).
  const base = isoParaData(dataIso) || new Date();
  const datas = [0,1,2].map(i => {
    const d = new Date(base); d.setDate(d.getDate() - i); return dataParaIso(d);
  });

  let registros = [];
  if(window.DB && DB.pronto) registros = await DB.buscarEvolucoesDasDatas(datas);
  registros = registros.filter(r => r.id !== edicaoId);

  // Ordena do mais antigo para o mais recente.
  const ordem = r => (2 - datas.indexOf(isoDoRegistro(r))) * 10 + indiceTurno(r.turno);
  registros.sort((a, b) => ordem(a) - ordem(b));

  // --- turno imediatamente anterior (mesmo dia; senão o último do dia anterior) ---
  const idxAtual = indiceTurno(turnoAtual);
  const doDia = registros.filter(r => isoDoRegistro(r) === dataIso);
  const anterioresNoDia = doDia.filter(r => indiceTurno(r.turno) < idxAtual);
  let anterior = anterioresNoDia[anterioresNoDia.length - 1];
  if(!anterior){
    const doDiaAnterior = registros.filter(r => isoDoRegistro(r) === datas[1]);
    anterior = doDiaAnterior[doDiaAnterior.length - 1];
  }

  if(anterior && anterior.dados){
    const antes = new Set((anterior.dados.estados || []).map(e => e.toLowerCase()));
    const agora = new Set((dados.estados || []).map(e => e.toLowerCase()));
    const novos = [...agora].filter(e => !antes.has(e));
    const cessaram = [...antes].filter(e => !agora.has(e));
    if(novos.length)    linhas.push(`Mudança em relação ao plantão ${anterior.turno.toLowerCase()}: apresentou ${novos.join(', ')}.`);
    if(cessaram.length) linhas.push(`Não apresenta mais: ${cessaram.join(', ')} (presente no plantão ${anterior.turno.toLowerCase()}).`);
  }

  // --- constipação: turnos seguidos sem evacuação ---
  const semEvacuacao = r => /sem evacua/i.test((r.dados && r.dados.evacuacao) || '');
  let seguidos = /sem evacua/i.test(dados.evacuacao) ? 1 : 0;
  if(seguidos){
    // Percorre de trás para frente: do plantão mais recente para o mais antigo.
    for(let i = registros.length - 1; i >= 0; i--){
      if(semEvacuacao(registros[i])) seguidos++; else break;
    }
    if(seguidos >= 3) linhas.push(`Sem evacuação há ${seguidos} plantões seguidos — atentar para constipação e comunicar o responsável.`);
  }

  // --- decúbito ---
  const mins = (dados.horarios || []).map(minutosDoHorario).sort((a,b)=>a-b);
  let maior = 0;
  for(let i = 1; i < mins.length; i++) maior = Math.max(maior, mins[i] - mins[i-1]);
  if(maior > INTERVALO_DECUBITO_H * 60){
    linhas.push(`Houve intervalo de ${(maior/60).toFixed(1).replace('.', ',')}h entre mudanças de decúbito.`);
  }

  // --- glicemia do dia ---
  if(window.DB && DB.pronto){
    const g = await DB.buscarGlicemiaDia(dataIso);
    if(g){
      ['cafe','almoco','janta'].forEach(chave => {
        const r = classificarGlicemia(g[chave] && g[chave].glicemia);
        if(r && r.nivel !== 'ok'){
          const rotulo = TURNOS.find(t => t.refeicao === chave).rotuloRefeicao;
          linhas.push(`${rotulo}: ${r.texto}`);
        }
      });
    }
  }

  return linhas;
}

/* ---------------------------------------------------------------------
   8. RASCUNHO AUTOMÁTICO (não perde nada se a página recarregar)
   --------------------------------------------------------------------- */
function coletarDados(){
  const chipsEstados = lerChips('listaEstados');
  const chipsMeds = lerChips('listaMedicacoes');
  return {
    turno: turnoAtual,
    dataIso: $('dataAtual').value,
    cuidadora: $('cuidadora').value,
    repasse: $('repasse').value,
    chipsEstados,
    chipsMedicacoes: chipsMeds,
    estados: chipsEstados.filter(c => c.on).map(c => c.valor),
    medicacoes: chipsMeds.filter(c => c.on).map(c => c.valor),
    usoFralda: $('usoFralda').checked,
    diurese: $('diurese').value,
    evacuacao: $('evacuacao').value,
    dieta: $('dieta').value.trim(),
    horarios: [...horarios],
    higieneDetalhes: $('higieneDetalhes').value.trim(),
    obs: $('obs').value.trim()
  };
}

function aplicarDados(d, opcoes){
  if(!d) return;
  restaurandoRascunho = true;
  const manterData = opcoes && opcoes.manterData;
  try{
    if(d.dataIso && !manterData) $('dataAtual').value = d.dataIso;
    if(d.cuidadora && CUIDADORAS.includes(d.cuidadora)) $('cuidadora').value = d.cuidadora;
    popularRepasse();
    if(d.repasse) $('repasse').value = d.repasse;
    if(d.turno) selecionarTurno(d.turno, indiceTurno(d.turno));

    aplicarChips('listaEstados', d.chipsEstados);
    aplicarChips('listaMedicacoes', d.chipsMedicacoes);

    const fralda = $('usoFralda');
    fralda.checked = !!d.usoFralda;
    fralda.closest('.toggle-row').classList.toggle('on', fralda.checked);

    if(d.diurese) $('diurese').value = d.diurese;
    if(d.evacuacao) $('evacuacao').value = d.evacuacao;
    $('dieta').value = d.dieta || '';
    $('higieneDetalhes').value = d.higieneDetalhes || '';
    $('obs').value = d.obs || '';
    horarios = Array.isArray(d.horarios) ? [...d.horarios] : [];
  } finally {
    restaurandoRascunho = false;
  }
  renderHorarios();
}

function salvarRascunho(){
  if(restaurandoRascunho) return;
  try{
    localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({
      salvoEm: Date.now(), edicaoId, dados: coletarDados()
    }));
  }catch(e){ /* armazenamento cheio ou bloqueado — não impede o uso */ }
}

function limparRascunho(){
  localStorage.removeItem(CHAVE_RASCUNHO);
}

function registrarAutoSalvamento(){
  ['dataAtual','cuidadora','repasse','diurese','evacuacao','dieta','higieneDetalhes','obs']
    .forEach(id => {
      $(id).addEventListener('input', salvarRascunho);
      $(id).addEventListener('change', salvarRascunho);
    });
  window.addEventListener('beforeunload', salvarRascunho);
}

function restaurarRascunho(bruto){
  if(!bruto) return;
  let r;
  try{ r = JSON.parse(bruto); }catch(e){ limparRascunho(); return; }
  if(!r || !r.dados) return;

  // Rascunho com mais de 24h provavelmente é de um plantão já encerrado.
  const horas = (Date.now() - (r.salvoEm || 0)) / 3600000;
  if(horas > 24){ limparRascunho(); return; }

  const banner = $('bannerRascunho');
  banner.hidden = false;
  banner.innerHTML =
    `<span>📝 Você tem um rascunho não enviado (${r.dados.turno || ''} · ${isoParaBR(r.dados.dataIso) || ''}).</span>` +
    `<button type="button" id="btnRestaurar">Restaurar</button>` +
    `<button type="button" id="btnDescartar" style="background:transparent;color:inherit;text-decoration:underline">Descartar</button>`;
  $('btnRestaurar').onclick = () => {
    edicaoId = r.edicaoId || null;
    aplicarDados(r.dados);
    atualizarModoEdicao();
    banner.hidden = true;
    aviso('Rascunho restaurado.', 'ok');
  };
  $('btnDescartar').onclick = () => { limparRascunho(); banner.hidden = true; };
}

/* ---------------------------------------------------------------------
   9. REPETIR PLANTÃO ANTERIOR
   --------------------------------------------------------------------- */
function repetirPlantaoAnterior(){
  const anteriores = cacheHistorico.filter(r => r.dados);
  if(anteriores.length === 0){
    aviso('Nenhum plantão anterior com dados salvos para copiar.', 'erro');
    return;
  }
  // Preferência: mesmo turno; senão, o mais recente qualquer.
  const base = anteriores.find(r => r.turno === turnoAtual) || anteriores[0];
  const copia = { ...base.dados };
  delete copia.dataIso;                  // mantém a data de hoje
  copia.cuidadora = $('cuidadora').value;
  copia.repasse = '';
  copia.turno = turnoAtual;
  copia.horarios = [];                   // horários são sempre do plantão atual
  copia.obs = 'Sem intercorrências.';
  aplicarDados(copia, { manterData: true });
  mostrarResultado(false);
  salvarRascunho();
  aviso(`Copiado do plantão ${base.turno.toLowerCase()} de ${base.dataFormatada}. Confira antes de gerar.`, 'ok');
}

/* ---------------------------------------------------------------------
   10. GERAR / ATUALIZAR A EVOLUÇÃO
   --------------------------------------------------------------------- */
function atualizarModoEdicao(){
  const btn = $('btnGerar');
  btn.innerText = edicaoId ? 'Atualizar evolução' : 'Gerar relatório de evolução';
  $('avisoEdicao').hidden = !edicaoId;
}

function cancelarEdicao(){
  edicaoId = null;
  atualizarModoEdicao();
  aviso('Edição cancelada. As alterações não foram gravadas.');
}

function montarTexto(dados, glicemiaTexto, observacoes){
  const estados = dados.estados;
  let paciente = 'Paciente acamada';
  if(estados.length > 0) paciente += ', ' + estados.join(', ');
  if(dados.usoFralda) paciente += '.\nEm uso de fralda';

  const medsTexto = dados.medicacoes.length > 0
    ? 'Medicação que usa:\n' + dados.medicacoes.join('\n') : '';
  const dietaTexto = dados.dieta ? `Dieta 🍽️\n${dados.dieta}` : '';

  let higieneTexto = '';
  if(dados.horarios.length > 0){
    higieneTexto = 'Higiene íntima, mudança de decúbito e trocas de fraldas:\n' +
      dados.horarios.map(h => `${h} · ${periodoDoHorario(h)}`).join('\n') + '\nRealizada ☝🏻';
  }
  if(dados.higieneDetalhes) higieneTexto += (higieneTexto ? '\n' : '') + dados.higieneDetalhes;

  const obsAuto = observacoes.length > 0 ? 'Pontos de atenção 🔎\n' + observacoes.map(l => `• ${l}`).join('\n') : '';

  return `${paciente}.\nEliminações fisiológicas.\n${dados.diurese}.\n${dados.evacuacao}.\n\n` +
    `${glicemiaTexto}\n\n${medsTexto}\n\n${dietaTexto}\n\n${higieneTexto}\n\n${dados.obs}\n\n${obsAuto}\n\n` +
    `Segue os cuidados com a ${dados.cuidadora}.` +
    `${dados.repasse ? `\nRepasse do plantão para ${dados.repasse}.` : ''}\n\n` +
    `Atenciosamente,\n${dados.cuidadora}`
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function gerarRelatorio(){
  const btn = $('btnGerar');
  const textoBtn = btn.innerText;
  const dataIso = $('dataAtual').value;

  // --- validações ---
  if(!dataIso){ aviso('Escolha a data do plantão antes de gerar.', 'erro'); $('dataAtual').focus(); return; }
  if(!$('cuidadora').value){ aviso('Selecione a cuidadora responsável.', 'erro'); return; }
  const dataDoPlantao = isoParaData(dataIso);
  const limiteFuturo = new Date(); limiteFuturo.setHours(23,59,59,999);
  if(dataDoPlantao > limiteFuturo){ aviso('A data do plantão está no futuro. Corrija antes de gerar.', 'erro'); return; }

  btn.innerText = 'Gerando...';
  btn.disabled = true;

  try{
    const dados = coletarDados();

    // --- anti-duplicata ---
    if(!edicaoId && window.DB && DB.pronto){
      const existente = await DB.buscarEvolucaoPorTurno(dataIso, turnoAtual);
      if(existente){
        const ok = confirm(
          `Já existe uma evolução do turno ${turnoAtual} em ${isoParaBR(dataIso)}, ` +
          `registrada por ${existente.cuidadora}.\n\nDeseja SUBSTITUIR esse registro?\n\n` +
          `OK = substituir · Cancelar = não salvar de novo`);
        if(!ok){ btn.innerText = textoBtn; btn.disabled = false; return; }
        edicaoId = existente.id;
      }
    }

    // --- glicemia do turno ---
    const turnoInfo = TURNOS[indiceTurno(turnoAtual)];
    let glicemiaTexto = '';
    if(window.DB && DB.pronto){
      const registroDia = await DB.buscarGlicemiaDia(dataIso);
      if(registroDia === undefined){
        glicemiaTexto = `Controle Glicêmico (${turnoInfo.rotuloRefeicao})\nNão foi possível carregar — verifique a internet.`;
      } else {
        const dadosRefeicao = registroDia ? registroDia[turnoInfo.refeicao] : null;
        if(dadosRefeicao && (dadosRefeicao.glicemia || dadosRefeicao.insulina)){
          glicemiaTexto = `Controle Glicêmico (${turnoInfo.rotuloRefeicao})\n` +
            `Glicemia: ${dadosRefeicao.glicemia || '-'} mg/dL\nInsulina: ${dadosRefeicao.insulina || '-'}`;
        } else {
          glicemiaTexto = `Controle Glicêmico (${turnoInfo.rotuloRefeicao})\nNão registrado neste horário.`;
        }
      }
    }

    const observacoes = await gerarObservacoesAutomaticas(dataIso, dados);
    const corpoTexto = montarTexto(dados, glicemiaTexto, observacoes);
    const dataFormatada = isoParaBR(dataIso);

    textoParaCompartilhar = `${saudacaoTexto}! 🌺\n\nEvolução ${turnoAtual} - ${dataFormatada}\n\n${corpoTexto}`;
    const campos = { rcSub: `Plantão ${turnoAtual} · ${dataFormatada}`, texto: corpoTexto };
    aplicarCamposNoCartao(campos);
    mostrarResultado(true);
    $('resultado').scrollIntoView({ behavior: 'smooth' });

    const registro = {
      dataIso, dataFormatada,
      turno: turnoAtual,
      cuidadora: dados.cuidadora,
      repasse: dados.repasse,
      campos, textoParaCompartilhar,
      dados,
      observacoes
    };

    if(!window.DB || !DB.pronto){
      aviso('Cartão gerado, mas não foi possível salvar no histórico compartilhado.', 'erro');
    } else if(edicaoId){
      await DB.atualizarEvolucao(edicaoId, registro);
      aviso('Evolução atualizada no histórico compartilhado.', 'ok');
      edicaoId = null;
    } else {
      await DB.salvarEvolucao(registro);
      aviso(DB.online ? 'Evolução salva e compartilhada.' : 'Salva no aparelho — vai sincronizar quando a internet voltar.', 'ok');
    }

    limparRascunho();
    $('bannerRascunho').hidden = true;
    if(observacoes.length) aviso(`⚠️ ${observacoes.length} ponto(s) de atenção incluídos no relatório.`);
  }catch(e){
    console.error(e);
    aviso('Não foi possível concluir: ' + (e.code || e.message), 'erro');
  }finally{
    btn.disabled = false;
    atualizarModoEdicao();
  }
}

// Mostra/esconde o cartão-resultado. Enquanto ele está escondido o botão
// principal fica grudado no rodapé; com o resultado à vista, volta ao fluxo.
function mostrarResultado(visivel){
  $('resultado').style.display = visivel ? 'block' : 'none';
  const barra = document.querySelector('.barra-acao');
  if(barra) barra.classList.toggle('solta', visivel);
}

function aplicarCamposNoCartao(c){
  $('rcSub').innerText = c.rcSub;
  $('rcTextoCompleto').innerText = c.texto;
}

/* ---------------------------------------------------------------------
   11. HISTÓRICO
   --------------------------------------------------------------------- */
function conectarHistorico(){
  if(!window.DB || !DB.pronto){
    $('listaHistorico').setAttribute('aria-busy', 'false');
    $('listaHistorico').innerHTML =
      '<span class="vazio-aviso">📡 Não foi possível carregar o histórico compartilhado (sem internet no primeiro acesso).<br>O restante do app funciona normalmente.</span>';
    definirStatusConexao('offline');
    return;
  }
  DB.aoMudarStatus = definirStatusConexao;
  if(cancelarEscuta) cancelarEscuta();
  cancelarEscuta = DB.ouvirEvolucoes(limiteHistorico, lista => {
    cacheHistorico = lista;
    popularFiltroMes(lista);
    renderizarListaHistoricoFiltrado();
    marcarTurnosRegistrados();
    avaliarPendencia();
    $('btnMaisHistorico').hidden = lista.length < limiteHistorico;
  }, () => {
    $('listaHistorico').setAttribute('aria-busy', 'false');
    $('listaHistorico').innerHTML =
      '<span class="vazio-aviso">📡 Não foi possível conectar ao histórico compartilhado.<br>Verifique sua internet.</span>';
  });
}

function carregarMaisHistorico(){
  limiteHistorico += PAGINA_HISTORICO;
  conectarHistorico();
  aviso('Carregando mais registros...');
}

function definirStatusConexao(estado){
  ['statusConexao', 'statusConexaoGlicemia'].forEach(id => {
    const badge = $(id);
    if(!badge) return;
    badge.classList.remove('online', 'offline');
    badge.classList.add(estado === 'online' ? 'online' : 'offline');
    badge.innerText = estado === 'online' ? '🟢 sincronizado' : '🔴 sem conexão';
  });
}

function popularFiltroMes(lista){
  const select = $('filtroMes');
  const valorAtual = select.value;
  const meses = new Map();
  lista.forEach(r => {
    const d = parseDataBR(r.dataFormatada) || isoParaData(r.dataIso);
    if(!d) return;
    const chave = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if(!meses.has(chave)) meses.set(chave, capitalizar(d.toLocaleDateString('pt-BR', { month:'long', year:'numeric' })));
  });
  const chaves = [...meses.keys()].sort().reverse();
  select.innerHTML = '<option value="">Todos os meses</option>' +
    chaves.map(c => `<option value="${c}">${escaparHtml(meses.get(c))}</option>`).join('');
  if(chaves.includes(valorAtual)) select.value = valorAtual;
}

function renderizarListaHistoricoFiltrado(){
  const mesFiltro = $('filtroMes').value;
  const cuidadoraFiltro = $('filtroCuidadora').value;

  const lista = cacheHistorico.filter(r => {
    if(cuidadoraFiltro && r.cuidadora !== cuidadoraFiltro) return false;
    if(mesFiltro){
      const iso = isoDoRegistro(r);
      if(iso.slice(0, 7) !== mesFiltro) return false;
    }
    return true;
  });

  const cont = $('listaHistorico');
  cont.setAttribute('aria-busy', 'false');
  if(lista.length === 0){
    const semFiltro = !mesFiltro && !cuidadoraFiltro;
    cont.innerHTML = '<span class="vazio-aviso">' + (semFiltro
      ? '📋 Nenhuma evolução registrada ainda.<br>Abra a aba Evolução para criar a primeira.'
      : '🔍 Nenhuma evolução encontrada com esse filtro.') + '</span>';
    return;
  }

  const hojeStr = formatarDataBR(new Date());
  const ontemD = new Date(); ontemD.setDate(ontemD.getDate() - 1);
  const ontemStr = formatarDataBR(ontemD);

  let html = '', mesAnterior = null, diaAnterior = null;

  lista.forEach(r => {
    const d = parseDataBR(r.dataFormatada) || isoParaData(r.dataIso);
    const chaveMes = d ? `${d.getFullYear()}-${d.getMonth()}` : 'sem-data';

    if(chaveMes !== mesAnterior){
      html += `<div class="hist-mes">${d ? escaparHtml(capitalizar(d.toLocaleDateString('pt-BR', { month:'long', year:'numeric' }))) : 'Data desconhecida'}</div>`;
      mesAnterior = chaveMes;
      diaAnterior = null;
    }

    if(r.dataFormatada !== diaAnterior){
      let rotulo = r.dataFormatada || 'Data não informada';
      if(r.dataFormatada === hojeStr) rotulo = 'Hoje';
      else if(r.dataFormatada === ontemStr) rotulo = 'Ontem';
      const iso = isoDoRegistro(r);
      html += `<div class="hist-dia">${escaparHtml(rotulo)}` +
        `<button type="button" class="btn-dia" onclick="montarResumoDoDia('${iso}')">Resumo 24h</button></div>`;
      diaAnterior = r.dataFormatada;
    }

    const atencao = (r.observacoes && r.observacoes.length) ? ' ⚠️' : '';
    html += `
      <div class="hist-item">
        <div>
          <div class="hist-titulo">${escaparHtml(r.turno)}${atencao}</div>
          <div class="hist-sub">${escaparHtml(r.cuidadora || '')}${r.repasse ? ' → ' + escaparHtml(r.repasse) : ''}</div>
        </div>
        <div class="hist-acoes">
          <button type="button" class="hist-btn" onclick="verHistorico('${r.id}')">Ver</button>
          <button type="button" class="hist-btn" onclick="editarHistorico('${r.id}')">Editar</button>
          <button type="button" class="hist-btn hist-excluir" aria-label="Excluir" onclick="excluirHistorico('${r.id}')">✕</button>
        </div>
      </div>`;
  });

  cont.innerHTML = html;
}

function verHistorico(id){
  const r = cacheHistorico.find(x => x.id === id);
  if(!r) return;
  aplicarCamposNoCartao(r.campos);
  textoParaCompartilhar = r.textoParaCompartilhar || '';
  mudarTela('evolucao');
  mostrarResultado(true);
  // Espera o scroll da troca de tela terminar antes de rolar até o cartão.
  setTimeout(() => $('resultado').scrollIntoView({ behavior: 'smooth' }), 350);
}

function editarHistorico(id){
  const r = cacheHistorico.find(x => x.id === id);
  if(!r) return;
  if(!r.dados){
    aviso('Esse registro é anterior à atualização do app e não pode ser editado — só visualizado.', 'erro');
    return;
  }
  edicaoId = id;
  aplicarDados({ ...r.dados, dataIso: isoDoRegistro(r), turno: r.turno });
  mostrarResultado(false);   // o cartão antigo não vale mais enquanto se edita
  atualizarModoEdicao();
  mudarTela('evolucao');
  aviso('Editando a evolução de ' + r.turno.toLowerCase() + ' · ' + r.dataFormatada);
}

async function excluirHistorico(id){
  const r = cacheHistorico.find(x => x.id === id);
  if(!r) return;
  const ok = confirm(
    `Excluir a evolução de ${r.turno.toLowerCase()} do dia ${r.dataFormatada} (${r.cuidadora})?\n\n` +
    `Essa ação não pode ser desfeita e apaga o registro para todas as cuidadoras.`);
  if(!ok) return;
  try{
    await DB.excluirEvolucao(id);
    aviso('Evolução excluída.', 'ok');
  }catch(e){
    aviso('Não foi possível excluir: ' + (e.code || e.message), 'erro');
  }
}

/* ---------------------------------------------------------------------
   12. RESUMO DO DIA (24h) E PENDÊNCIA DE TURNO
   --------------------------------------------------------------------- */
function turnosRegistradosEm(dataIso){
  return new Set(cacheHistorico.filter(r => isoDoRegistro(r) === dataIso).map(r => r.turno));
}

function marcarTurnosRegistrados(){
  const registrados = turnosRegistradosEm($('dataAtual').value);
  document.querySelectorAll('.turno-btn').forEach(b => {
    b.classList.toggle('registrado', registrados.has(b.dataset.turno));
  });
}

function avaliarPendencia(){
  const banner = $('bannerPendente');
  if(!banner) return;
  const hojeIso = dataParaIso(new Date());
  if($('dataAtual').value !== hojeIso){ banner.hidden = true; return; }

  const turnoAgora = turnoPorHora(new Date().getHours());
  const registrados = turnosRegistradosEm(hojeIso);
  // Já registrado, ou a cuidadora já está com esse turno aberto: nada a avisar.
  if(registrados.has(turnoAgora) || turnoAtual === turnoAgora){ banner.hidden = true; return; }

  banner.hidden = false;
  banner.innerHTML = `<span>⏰ O plantão <b>${turnoAgora}</b> de hoje ainda não tem evolução registrada.</span>` +
    `<button type="button" onclick="selecionarTurno('${turnoAgora}', ${indiceTurno(turnoAgora)})">Registrar agora</button>`;
}

async function montarResumoDoDia(dataIso){
  const doDia = cacheHistorico
    .filter(r => isoDoRegistro(r) === dataIso)
    .sort((a,b) => indiceTurno(a.turno) - indiceTurno(b.turno));

  if(doDia.length === 0){ aviso('Nenhuma evolução registrada nesse dia.', 'erro'); return; }

  const d = isoParaData(dataIso);
  let texto = `*RESUMO DO DIA — ${d.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}*\n\n`;

  // Glicemia consolidada
  if(window.DB && DB.pronto){
    const g = await DB.buscarGlicemiaDia(dataIso);
    if(g){
      texto += '🩸 *Controle glicêmico*\n';
      TURNOS.forEach(t => {
        const item = g[t.refeicao] || {};
        if(item.glicemia || item.insulina){
          const cls = classificarGlicemia(item.glicemia);
          const marca = cls && cls.nivel === 'perigo' ? ' 🚨' : cls && cls.nivel === 'atencao' ? ' ⚠️' : '';
          texto += `${t.rotuloRefeicao}: ${item.glicemia || '-'} mg/dL · ${item.insulina || 'sem insulina'}${marca}\n`;
        }
      });
      texto += '\n';
    }
  }

  // Um bloco por turno
  doDia.forEach(r => {
    texto += `*${r.turno} — ${r.cuidadora}*\n`;
    const dd = r.dados;
    if(dd){
      if(dd.estados && dd.estados.length) texto += `Estado: ${dd.estados.join(', ')}\n`;
      texto += `${dd.diurese}. ${dd.evacuacao}.\n`;
      if(dd.dieta) texto += `Dieta: ${dd.dieta}\n`;
      if(dd.horarios && dd.horarios.length) texto += `Trocas/decúbito: ${dd.horarios.join(', ')}\n`;
      if(dd.obs) texto += `Obs.: ${dd.obs}\n`;
    } else {
      texto += (r.campos && r.campos.texto ? r.campos.texto : '') + '\n';
    }
    if(r.observacoes && r.observacoes.length){
      texto += r.observacoes.map(o => `⚠️ ${o}`).join('\n') + '\n';
    }
    texto += '\n';
  });

  const faltando = TURNOS.map(t => t.nome).filter(n => !doDia.some(r => r.turno === n));
  if(faltando.length) texto += `_Sem registro: ${faltando.join(', ')}._\n`;

  $('textoResumoDia').innerText = texto.trim();
  $('cardResumoDia').hidden = false;
  $('cardResumoDia').scrollIntoView({ behavior: 'smooth' });
}

function enviarResumoDoDia(){
  const texto = $('textoResumoDia').innerText;
  if(!texto) return;
  window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(texto), '_blank');
}

function copiarResumoDoDia(){
  const texto = $('textoResumoDia').innerText;
  navigator.clipboard.writeText(texto)
    .then(() => aviso('Resumo copiado.', 'ok'))
    .catch(() => aviso('Não foi possível copiar.', 'erro'));
}

/* ---------------------------------------------------------------------
   13. IMAGEM / COMPARTILHAMENTO
   --------------------------------------------------------------------- */
async function gerarPng(elemento){
  if(typeof html2canvas !== 'function') throw new Error('gerador de imagem indisponível offline');
  const canvas = await html2canvas(elemento, { scale: 3, backgroundColor: '#FFFDF8', useCORS: true });
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

async function compartilharImagem(blob, nomeArquivo, titulo){
  const file = new File([blob], nomeArquivo, { type: 'image/png' });
  if(navigator.canShare && navigator.canShare({ files: [file] })){
    await navigator.share({ files: [file], title: titulo });
    return 'compartilhado';
  }
  baixarBlob(blob, nomeArquivo);
  return 'baixado';
}

function baixarBlob(blob, nomeArquivo){
  const link = document.createElement('a');
  link.download = nomeArquivo;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

async function enviarWhatsapp(){
  const btn = $('btnEnviar');
  const original = btn.innerHTML;
  btn.innerHTML = 'Gerando imagem...';
  btn.disabled = true;
  try{
    const blob = await gerarPng($('cartaoResumo'));
    const nome = `evolucao-${$('dataAtual').value}-${turnoAtual.toLowerCase()}.png`;
    const r = await compartilharImagem(blob, nome, 'Evolução do plantão');
    btn.innerHTML = r === 'compartilhado' ? '✅ Enviado!' : '✅ Imagem baixada — anexe no WhatsApp';
  }catch(e){
    console.error(e);
    btn.innerHTML = 'Não foi possível gerar a imagem';
  }finally{
    btn.disabled = false;
    setTimeout(() => { btn.innerHTML = original; }, 2500);
  }
}

async function baixarImagem(){
  const btn = $('btnBaixar');
  const original = btn.innerHTML;
  btn.innerHTML = 'Gerando...';
  try{
    const blob = await gerarPng($('cartaoResumo'));
    baixarBlob(blob, `evolucao-${$('dataAtual').value}-${turnoAtual.toLowerCase()}.png`);
    btn.innerHTML = '✅ Baixado!';
  }catch(e){
    btn.innerHTML = 'Erro ao gerar imagem';
  }finally{
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  }
}

function copiarTexto(){
  if(!textoParaCompartilhar){ aviso('Gere o relatório primeiro.', 'erro'); return; }
  navigator.clipboard.writeText(textoParaCompartilhar)
    .then(() => aviso('Texto copiado — cole no WhatsApp.', 'ok'))
    .catch(() => aviso('Não foi possível copiar.', 'erro'));
}

/* ---------------------------------------------------------------------
   14. CONTROLE GLICÊMICO
   --------------------------------------------------------------------- */
async function salvarGlicemia(){
  const dataIso = $('dataGlicemia').value;
  if(!dataIso){ aviso('Selecione uma data válida.', 'erro'); return; }
  const [ano, mes, dia] = dataIso.split('-');

  const registro = {
    data: dataIso, dataIso, dia, mesAno: `${ano}-${mes}`,
    cafe:   { insulina: $('insulinaCafe').value.trim(),   glicemia: $('glicemiaCafe').value },
    almoco: { insulina: $('insulinaAlmoco').value.trim(), glicemia: $('glicemiaAlmoco').value },
    janta:  { insulina: $('insulinaJanta').value.trim(),  glicemia: $('glicemiaJanta').value }
  };

  if(!registro.cafe.glicemia && !registro.almoco.glicemia && !registro.janta.glicemia){
    aviso('Preencha pelo menos um valor de glicemia antes de salvar.', 'erro');
    return;
  }

  // Confirma valores implausíveis antes de gravar no prontuário.
  const suspeitos = ['cafe','almoco','janta']
    .map(k => Number(registro[k].glicemia))
    .filter(v => v && (v < 20 || v > 600));
  if(suspeitos.length && !confirm(`Valor incomum registrado: ${suspeitos.join(', ')} mg/dL.\nConfirma que está correto?`)) return;

  if(!window.DB || !DB.pronto){ aviso('Sem conexão com o banco compartilhado.', 'erro'); return; }

  try{
    await DB.salvarGlicemiaDia(dataIso, registro);
    aviso(`Registro de ${dia}/${mes}/${ano} salvo.`, 'ok');
    ['glicemiaCafe','glicemiaAlmoco','glicemiaJanta'].forEach(id => { $(id).value = ''; });
    ['cafe','almoco','janta'].forEach(avaliarGlicemiaCampo);
    if($('areaTabelaGlicemia').style.display === 'block') gerarTabelaGlicemia();
  }catch(e){
    aviso('Não foi possível salvar: ' + e.message, 'erro');
  }
}

// Carrega no formulário o que já existe para a data escolhida (evita sobrescrever sem querer).
async function carregarGlicemiaDaData(){
  const dataIso = $('dataGlicemia').value;
  if(!dataIso || !window.DB || !DB.pronto) return;
  const g = await DB.buscarGlicemiaDia(dataIso);
  const mapa = { cafe:'Cafe', almoco:'Almoco', janta:'Janta' };
  Object.keys(mapa).forEach(k => {
    const item = (g && g[k]) || {};
    $('insulina' + mapa[k]).value = item.insulina || '';
    $('glicemia' + mapa[k]).value = item.glicemia || '';
    avaliarGlicemiaCampo(k);
  });
  if(g) aviso('Este dia já tinha registro — carreguei os valores para você conferir.');
}

function estatisticasGlicemia(dados){
  const valores = [];
  dados.forEach(item => ['cafe','almoco','janta'].forEach(k => {
    const v = Number(item[k] && item[k].glicemia);
    if(v) valores.push(v);
  }));
  if(valores.length === 0) return null;
  const soma = valores.reduce((a,b) => a+b, 0);
  const foraDaFaixa = valores.filter(v => v < GLICEMIA.hipo || v > GLICEMIA.alvoMax).length;
  return {
    n: valores.length,
    media: Math.round(soma / valores.length),
    min: Math.min(...valores),
    max: Math.max(...valores),
    hipos: valores.filter(v => v < GLICEMIA.hipo).length,
    percentualFora: Math.round(foraDaFaixa / valores.length * 100)
  };
}

function mediaDoDia(item){
  const vals = ['cafe','almoco','janta'].map(k => Number(item[k] && item[k].glicemia)).filter(Boolean);
  return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : null;
}

function desenharSparkline(dados){
  const svg = $('sparkline');
  const pontos = dados.map(d => ({ dia: Number(d.dia), media: mediaDoDia(d) })).filter(p => p.media);
  if(pontos.length < 2){ svg.innerHTML = ''; return; }

  const L = 300, A = 70, pad = 6;
  const min = Math.min(GLICEMIA.hipo - 10, ...pontos.map(p => p.media));
  const max = Math.max(GLICEMIA.alvoMax + 10, ...pontos.map(p => p.media));
  const x = i => pad + i * (L - 2*pad) / (pontos.length - 1);
  const y = v => A - pad - (v - min) / (max - min) * (A - 2*pad);

  const faixaTopo = y(GLICEMIA.alvoMax), faixaBase = y(GLICEMIA.hipo);
  const linha = pontos.map((p,i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.media).toFixed(1)}`).join(' ');
  const bolinhas = pontos.map((p,i) => {
    const cor = p.media < GLICEMIA.hipo ? '#B5533C' : p.media > GLICEMIA.alvoMax ? '#D98E4A' : '#4F7A5E';
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.media).toFixed(1)}" r="2.6" fill="${cor}"/>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${L} ${A}`);
  svg.innerHTML =
    `<rect x="0" y="${faixaTopo.toFixed(1)}" width="${L}" height="${(faixaBase-faixaTopo).toFixed(1)}" fill="#DDE9DF"/>` +
    `<path d="${linha}" fill="none" stroke="#34503E" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>` +
    bolinhas;
}

function celulaGlicemia(item){
  const v = Number(item && item.glicemia);
  const ins = (item && item.insulina) || '-';
  if(!v) return `-<br><small>${escaparHtml(ins)}</small>`;
  const cls = v < GLICEMIA.hipo ? 'v-baixa' : v > GLICEMIA.alvoMax ? 'v-alta' : '';
  return `<span class="${cls}">${v}</span><br><small>${escaparHtml(ins)}</small>`;
}

async function obterDadosMes(){
  const mes = $('mesGlicemia').value;
  if(!mes){ aviso('Selecione um mês e ano para o relatório.', 'erro'); return null; }
  if(!window.DB || !DB.pronto){ aviso('Sem conexão com o banco compartilhado.', 'erro'); return null; }
  try{
    return { mes, dados: await DB.buscarGlicemiaMes(mes) };
  }catch(e){
    aviso('Não foi possível carregar o relatório: ' + e.message, 'erro');
    return null;
  }
}

async function gerarTabelaGlicemia(){
  const r = await obterDadosMes();
  if(!r) return;
  const [ano, mes] = r.mes.split('-');
  $('labelMesGlicemia').innerText = `${mes}/${ano}`;

  const tbody = document.querySelector('#tabelaGlicemia tbody');
  tbody.innerHTML = r.dados.length === 0
    ? '<tr><td colspan="4" style="padding:20px;">Nenhum registro encontrado para este mês.</td></tr>'
    : r.dados.map(item => `<tr>
        <td>${escaparHtml(item.dia)}/${mes}</td>
        <td>${celulaGlicemia(item.cafe)}</td>
        <td>${celulaGlicemia(item.almoco)}</td>
        <td>${celulaGlicemia(item.janta)}</td>
      </tr>`).join('');

  const st = estatisticasGlicemia(r.dados);
  const painel = $('painelTendencia');
  if(st){
    painel.hidden = false;
    $('statMedia').innerText = st.media;
    $('statMin').innerText = st.min;
    $('statMax').innerText = st.max;
    $('statFora').innerText = st.percentualFora + '%';
    $('boxMin').classList.toggle('destaque-baixa', st.min < GLICEMIA.hipo);
    $('boxMax').classList.toggle('destaque-alta', st.max > GLICEMIA.alvoMax);
    $('legendaFaixa').innerText =
      `${st.n} medições · faixa alvo ${GLICEMIA.hipo}–${GLICEMIA.alvoMax} mg/dL` +
      (st.hipos ? ` · ${st.hipos} episódio(s) de hipoglicemia` : '');
    desenharSparkline(r.dados);
  } else {
    painel.hidden = true;
  }
  $('areaTabelaGlicemia').style.display = 'block';
  $('areaTabelaGlicemia').scrollIntoView({ behavior: 'smooth' });
}

async function enviarGlicemiaWhatsapp(){
  const r = await obterDadosMes();
  if(!r) return;
  if(r.dados.length === 0){ aviso('Nenhum registro encontrado para o mês selecionado.', 'erro'); return; }
  const [ano, mes] = r.mes.split('-');
  const st = estatisticasGlicemia(r.dados);

  let texto = `*📊 MAPA GLICÊMICO — ${mes}/${ano}*\n\n`;
  if(st){
    texto += `Média ${st.media} · mínima ${st.min} · máxima ${st.max} mg/dL\n` +
             `${st.percentualFora}% das ${st.n} medições fora da faixa ${GLICEMIA.hipo}–${GLICEMIA.alvoMax}` +
             (st.hipos ? ` · ${st.hipos} hipoglicemia(s)` : '') + '\n\n';
  }
  r.dados.forEach(item => {
    const marca = k => {
      const c = classificarGlicemia(item[k] && item[k].glicemia);
      return c && c.nivel === 'perigo' ? ' 🚨' : c && c.nivel === 'atencao' ? ' ⚠️' : '';
    };
    texto += `*Dia ${item.dia}/${mes}*\n`;
    texto += `☕ ${item.cafe.glicemia || '-'} (${item.cafe.insulina || '-'})${marca('cafe')}\n`;
    texto += `🍲 ${item.almoco.glicemia || '-'} (${item.almoco.insulina || '-'})${marca('almoco')}\n`;
    texto += `🍽️ ${item.janta.glicemia || '-'} (${item.janta.insulina || '-'})${marca('janta')}\n`;
    texto += `---------------------\n`;
  });
  window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(texto), '_blank');
}

async function baixarTabelaGlicemia(){
  const area = $('areaTabelaGlicemia');
  if(area.style.display !== 'block'){ aviso('Gere a tabela primeiro.', 'erro'); return; }
  try{
    const blob = await gerarPng(area);
    await compartilharImagem(blob, `glicemia-${$('mesGlicemia').value}.png`, 'Mapa glicêmico');
    aviso('Imagem do mapa glicêmico pronta.', 'ok');
  }catch(e){
    aviso('Não foi possível gerar a imagem.', 'erro');
  }
}

/* ---------------------------------------------------------------------
   15. RELATÓRIO MENSAL PARA IMPRESSÃO / PDF
   --------------------------------------------------------------------- */
async function imprimirRelatorioMensal(){
  const r = await obterDadosMes();
  if(!r) return;
  const [ano, mes] = r.mes.split('-');
  const st = estatisticasGlicemia(r.dados);

  const evolucoesDoMes = cacheHistorico
    .filter(e => isoDoRegistro(e).slice(0,7) === r.mes)
    .sort((a,b) => isoDoRegistro(a).localeCompare(isoDoRegistro(b)) || indiceTurno(a.turno) - indiceTurno(b.turno));

  let html = `<h1>Relatório mensal de cuidados — ${mes}/${ano}</h1>` +
    `<div class="imp-sub">Gerado em ${formatarDataBR(new Date())} · Faixa alvo de glicemia: ${GLICEMIA.hipo}–${GLICEMIA.alvoMax} mg/dL</div>`;

  if(st){
    html += `<div class="imp-secao">Resumo glicêmico</div>` +
      `<p>${st.n} medições · média <b>${st.media}</b> mg/dL · mínima <b>${st.min}</b> · máxima <b>${st.max}</b> · ` +
      `<b>${st.percentualFora}%</b> fora da faixa alvo · ${st.hipos} episódio(s) de hipoglicemia (&lt;${GLICEMIA.hipo} mg/dL).</p>`;
  }

  html += `<div class="imp-secao">Mapa glicêmico</div>`;
  if(r.dados.length === 0){
    html += '<p>Nenhum registro glicêmico neste mês.</p>';
  } else {
    html += '<table><thead><tr><th>Dia</th><th>Café (glic/ins)</th><th>Almoço (glic/ins)</th><th>Janta (glic/ins)</th></tr></thead><tbody>' +
      r.dados.map(i => `<tr><td>${escaparHtml(i.dia)}/${mes}</td>` +
        ['cafe','almoco','janta'].map(k =>
          `<td>${escaparHtml((i[k] && i[k].glicemia) || '-')} / ${escaparHtml((i[k] && i[k].insulina) || '-')}</td>`).join('') +
        '</tr>').join('') + '</tbody></table>';
  }

  html += `<div class="imp-secao">Evoluções de plantão (${evolucoesDoMes.length})</div>`;
  html += evolucoesDoMes.length === 0
    ? '<p>Nenhuma evolução carregada para este mês.</p>'
    : evolucoesDoMes.map(e =>
        `<div class="imp-evolucao"><b>${escaparHtml(e.dataFormatada)} · ${escaparHtml(e.turno)} · ${escaparHtml(e.cuidadora || '')}</b>\n` +
        `${escaparHtml((e.campos && e.campos.texto) || '')}</div>`).join('');

  $('areaImpressao').innerHTML = html;
  aviso('Na janela de impressão, escolha "Salvar como PDF".');
  setTimeout(() => window.print(), 300);
}

/* ---------------------------------------------------------------------
   16. BOOT
   --------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', iniciar);
