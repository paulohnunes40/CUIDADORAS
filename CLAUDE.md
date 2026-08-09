# CLAUDE.md

App estático (sem build, sem npm) hospedado no Firebase Hosting. Português do Brasil
em todo o código: nomes de funções, variáveis, comentários e textos da interface.

## Arquitetura

- `index.html` — só estrutura. Handlers ficam em atributos `onclick` no HTML, então
  **as funções de `js/app.js` precisam continuar no escopo global** (script clássico,
  nunca `type="module"`).
- `js/dados.js` — única camada que fala com o Firestore, exposta em `window.DB`.
  Carrega antes de `js/app.js`. Nenhum outro arquivo deve chamar `firebase.*`.
- `js/app.js` — interface e análises clínicas. Entra por `iniciar()` no `DOMContentLoaded`.
- `sw.js` — service worker. **Ao publicar mudanças, incremente `VERSAO`**, senão os
  celulares seguem abrindo o cache antigo.

## Modelo de dados (Firestore)

`evolucoes/{auto}`:
```js
{ dataIso: '2026-08-08',        // chave canônica de data — sempre gravar
  dataFormatada: '08/08/2026',  // só para exibição
  turno: 'Manhã'|'Tarde'|'Noite',
  cuidadora, repasse,
  campos: { rcSub, texto },     // o que aparece no cartão
  textoParaCompartilhar,
  dados: { ... },               // formulário completo — permite editar e repetir plantão
  observacoes: [],              // alertas automáticos
  criadoEm, atualizadoEm }
```

`glicemia/{dataIso}` — um documento por dia, id = data ISO (nunca duplica o dia).

Registros antigos não têm `dataIso` nem `dados`: use sempre `isoDoRegistro(r)` para ler
a data, e trate `dados` ausente (esses registros só podem ser visualizados, não editados).

## Regras do domínio

- Faixa alvo de glicemia e limiares ficam na constante `GLICEMIA` no topo de `js/app.js`.
- Intervalo máximo entre mudanças de decúbito: `INTERVALO_DECUBITO_H` (3h).
- Nomes das cuidadoras: **só** na constante `CUIDADORAS`. Os `<select>` são gerados a
  partir dela — nunca escreva os nomes direto no HTML.
- Texto digitado pela cuidadora (chips avulsos) vai para `innerHTML` em vários pontos:
  **sempre passe por `escaparHtml()`**.

## Testes

`node testes/logica.test.js` — simula um DOM mínimo e testa as funções puras
(classificação de glicemia, estatísticas, datas, montagem do texto). Rode depois de
mexer nessas partes.

## Restrições

- Sem login, por decisão do projeto. Não adicione autenticação sem pedir.
- Sem etapa de build: nada de bundler, TypeScript ou dependências npm no runtime.
