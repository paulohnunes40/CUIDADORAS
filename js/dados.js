/* =========================================================================
   Camada de dados — Firestore compartilhado entre as cuidadoras.
   Expõe window.DB com uma API simples e em português.
   Tudo funciona offline: o Firestore mantém um cache local e sincroniza
   sozinho quando a internet volta.
   ========================================================================= */
(function(){
  'use strict';

  const firebaseConfig = {
    apiKey: "AIzaSyCsdLUMBxwd7Q0ebeaQoNmwPZs37eOCAp8",
    authDomain: "evolucao-cuidadoras.firebaseapp.com",
    projectId: "evolucao-cuidadoras",
    storageBucket: "evolucao-cuidadoras.firebasestorage.app",
    messagingSenderId: "141542865889",
    appId: "1:141542865889:web:45fb42e67887642f16f0a0"
  };

  const DB = {
    pronto: false,
    online: false,
    aoMudarStatus: null   // callback(estado) definido pelo app
  };
  window.DB = DB;

  function definirStatus(estado){
    DB.online = (estado === 'online');
    if(typeof DB.aoMudarStatus === 'function') DB.aoMudarStatus(estado);
  }
  DB.definirStatus = definirStatus;

  // O Firestore SEMPRE entrega o primeiro snapshot do cache local
  // (fromCache = true) antes de a resposta do servidor chegar, e volta a
  // marcá-lo enquanto há escrita pendente. Tratar isso como "sem conexão"
  // fazia o app dizer que estava offline com a internet funcionando.
  // Só é offline de verdade quando o próprio aparelho está sem rede.
  function statusDoSnapshot(snapshot){
    if(!snapshot.metadata.fromCache) return 'online';
    return navigator.onLine ? 'sincronizando' : 'offline';
  }

  window.addEventListener('online',  () => definirStatus('sincronizando'));
  window.addEventListener('offline', () => definirStatus('offline'));

  if(typeof firebase === 'undefined'){
    console.error('SDK do Firebase não carregou (sem internet no primeiro acesso?).');
    definirStatus('offline');
    return;
  }

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  // Cache local: o app continua lendo e escrevendo sem internet.
  db.enablePersistence({ synchronizeTabs: true }).catch(e => {
    console.warn('Persistência offline indisponível neste navegador:', e.code);
  });

  const evolucoesRef = db.collection('evolucoes');
  const glicemiaRef  = db.collection('glicemia');
  DB.pronto = true;

  function erro(contexto, e){
    console.error(contexto, e);
    return e.code || e.message || 'erro desconhecido';
  }

  /* ---------------------- EVOLUÇÕES ---------------------- */

  // Cria uma evolução nova e devolve o id.
  DB.salvarEvolucao = async function(registro){
    const doc = await evolucoesRef.add({
      ...registro,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    return doc.id;
  };

  // Sobrescreve uma evolução existente (usado ao editar ou substituir duplicata).
  DB.atualizarEvolucao = async function(id, registro){
    await evolucoesRef.doc(id).set({
      ...registro,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return id;
  };

  DB.excluirEvolucao = function(id){
    return evolucoesRef.doc(id).delete();
  };

  // Procura uma evolução já registrada para a mesma data + turno (anti-duplicata).
  DB.buscarEvolucaoPorTurno = async function(dataIso, turno){
    try{
      const snap = await evolucoesRef
        .where('dataIso', '==', dataIso)
        .where('turno', '==', turno)
        .limit(1).get();
      if(snap.empty) return null;
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    }catch(e){
      erro('Erro ao verificar evolução duplicada:', e);
      return undefined;   // undefined = não deu para verificar (≠ não existe)
    }
  };

  // Todas as evoluções de um conjunto de datas (máx. 10 datas — limite do Firestore).
  DB.buscarEvolucoesDasDatas = async function(datasIso){
    try{
      const snap = await evolucoesRef.where('dataIso', 'in', datasIso.slice(0, 10)).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }catch(e){
      erro('Erro ao buscar evoluções por data:', e);
      return [];
    }
  };

  // Escuta o histórico em tempo real. Devolve a função para cancelar a escuta.
  DB.ouvirEvolucoes = function(limite, aoReceber, aoFalhar){
    return evolucoesRef.orderBy('criadoEm', 'desc').limit(limite).onSnapshot(snapshot => {
      definirStatus(statusDoSnapshot(snapshot));
      aoReceber(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, e => {
      erro('Erro ao conectar ao histórico compartilhado:', e);
      definirStatus('offline');
      if(aoFalhar) aoFalhar(e);
    });
  };

  /* ---------------------- GLICEMIA ---------------------- */

  // Um documento por dia (id = data ISO) — nunca duplica o mesmo dia.
  DB.salvarGlicemiaDia = async function(dataIso, registro){
    try{
      await glicemiaRef.doc(dataIso).set(registro, { merge: true });
      return true;
    }catch(e){
      throw new Error(erro('Erro ao salvar registro glicêmico:', e));
    }
  };

  DB.buscarGlicemiaDia = async function(dataIso){
    try{
      const doc = await glicemiaRef.doc(dataIso).get();
      return doc.exists ? doc.data() : null;
    }catch(e){
      erro('Erro ao buscar glicemia do dia:', e);
      return undefined;   // undefined = falha de leitura (≠ sem registro)
    }
  };

  DB.buscarGlicemiaMes = async function(mesAno){
    try{
      const snap = await glicemiaRef.where('mesAno', '==', mesAno).get();
      const lista = snap.docs.map(d => d.data());
      lista.sort((a, b) => String(a.data).localeCompare(String(b.data)));
      return lista;
    }catch(e){
      throw new Error(erro('Erro ao buscar registros glicêmicos:', e));
    }
  };
})();
