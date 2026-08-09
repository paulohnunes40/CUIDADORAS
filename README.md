# Evolução · Registro de Plantão

App para as cuidadoras registrarem a evolução de cada plantão e o controle glicêmico
da paciente, gerando um cartão pronto para enviar no WhatsApp. Os dados são
compartilhados entre as três cuidadoras em tempo real (Firestore) e o app funciona
mesmo sem internet.

## Como usar no celular

Abra o endereço no navegador e escolha **"Adicionar à tela de início"**. Ele passa a
abrir como aplicativo, em tela cheia, e funciona offline.

## As três telas

| Tela | Para quê |
|---|---|
| 📋 **Evolução** | Registrar o plantão (estado, medicação, dieta, trocas, observações) e gerar o cartão |
| 🩸 **Glicemia** | Registrar glicemia e insulina do café/almoço/janta e ver o relatório mensal |
| 🕒 **Histórico** | Ver, editar ou excluir evoluções anteriores e montar o resumo das 24h |

## O que o app faz sozinho

- **Salva rascunho automático.** Se o celular travar ou a página recarregar no meio do
  plantão, ao voltar ele oferece restaurar tudo o que já tinha sido preenchido.
- **Avisa sobre duplicatas.** Se já existe evolução daquele turno naquele dia, ele
  pergunta antes de gravar de novo.
- **Alerta na glicemia.** Marca hipoglicemia (< 70), valores acima da faixa alvo (> 180),
  hiperglicemia importante (≥ 250), valores críticos (≥ 400) e insulina anotada sem
  a glicemia correspondente.
- **Vigia a mudança de decúbito.** Se o intervalo entre trocas passar de 3h, avisa —
  é o intervalo recomendado para prevenir lesão por pressão.
- **Compara com o plantão anterior.** Escreve no relatório o que mudou (novos estados,
  estados que cessaram) e alerta quando são 3 ou mais plantões seguidos sem evacuação.
- **Repete o plantão anterior** com um toque, para não redigitar medicação e dieta.
- **Lembra do turno pendente**: avisa se o plantão em curso ainda não foi registrado.
- **Resumo de 24h**: junta os três turnos e a glicemia do dia em uma única mensagem.
- **Relatório mensal em PDF** para levar na consulta médica, com média, mínima, máxima
  e percentual fora da faixa alvo.

## Estrutura dos arquivos

```
index.html          estrutura das telas
styles.css          todo o visual
js/dados.js         acesso ao Firestore (window.DB) e cache offline
js/app.js           lógica da interface e as análises clínicas
sw.js               service worker — faz o app abrir sem internet
manifest.json       define o app instalável
firestore.rules     regras do banco (ver aviso abaixo)
testes/             testes da lógica clínica
```

## Rodar os testes

Os testes cobrem a classificação de glicemia, as estatísticas mensais, as conversões
de data e a montagem do texto da evolução. Com o Node instalado:

```bash
node testes/logica.test.js
```

## Publicar

```bash
firebase deploy --only hosting,firestore:rules
```

Ao publicar uma versão nova, o service worker precisa de um número novo: mude a
constante `VERSAO` no topo de `sw.js` (ex.: `evolucao-v1` → `evolucao-v2`), senão os
celulares continuam abrindo a versão antiga guardada no cache.

## ⚠️ Aviso importante sobre privacidade

**O app não tem login** — foi uma decisão do projeto. Sem autenticação, qualquer pessoa
que descubra o endereço do banco consegue ler e gravar os dados de saúde da paciente.
O arquivo `firestore.rules` limita o estrago possível (só as duas coleções esperadas,
com formato e tamanho validados), mas **não substitui login**.

Se um dia quiser proteger de verdade, ative o Firebase Auth e troque `true` por
`request.auth != null` nas regras.
