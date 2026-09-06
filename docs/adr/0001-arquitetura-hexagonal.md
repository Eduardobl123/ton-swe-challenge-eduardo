# ADR 0001 — Arquitetura hexagonal com composition root manual

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#1](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/1)

## Contexto

O desafio pede "organização estruturada de código" e "arquiteturas que deixem a
aplicação eficiente". A aplicação tem regra de negócio real — política de
bloqueio de conta, rotação de refresh token, paginação por cursor — e três
fontes de acoplamento tecnológico fortes: framework HTTP, DynamoDB e AWS Lambda.

Sem uma fronteira explícita, a regra de negócio se dissolve dentro de handlers
do Fastify e de chamadas ao SDK da AWS. O resultado previsível é que testar o
lockout exige subir um container, e trocar de banco vira reescrita.

## Decisão

Arquitetura hexagonal com quatro camadas e a dependência apontando sempre para
dentro: `domain` → `application` → `infrastructure` → `main`.

O domínio declara **portas** (interfaces como `UserRepository`, `TokenSigner`,
`Clock`) e a infraestrutura as implementa. O núcleo não importa pacote de
terceiros nenhum.

A regra é verificada por lint, não por convenção. `eslint-plugin-boundaries`
bloqueia importações na direção errada e `no-restricted-imports` impede que o
núcleo dependa de pacotes externos. `npm run lint` falha nos dois casos.

O grafo de dependências é montado por uma função `buildContainer(config)` em
`src/main/container.ts`, sem container de injeção de dependência.

## Alternativas consideradas

**Arquitetura em camadas tradicional (controller / service / repository).** Mais
familiar e mais rápida de escrever. Descartada porque a dependência aponta para
fora: o service importa o repositório concreto, o que arrasta o SDK da AWS para
dentro da regra de negócio e torna o teste unitário dependente de mock de
biblioteca em vez de implementação de interface.

**Container de injeção de dependência (`tsyringe`, `inversify`).** Reduziria a
fiação manual. Descartado por dois motivos: adiciona reflexão e metadados ao
cold start do Lambda, e esconde o grafo de dependências atrás de decorators —
"ir para definição" deixa de responder quem implementa o quê. Numa aplicação
com meia dúzia de adaptadores, a fiação manual cabe em uma tela.

**Fronteiras apenas documentadas.** Descartada: sem lint que falhe, a primeira
importação apressada de um cliente DynamoDB dentro de um caso de uso passa na
revisão e a arquitetura vira ficção.

## Consequências

**Positivas.** Casos de uso são testáveis em milissegundos com fakes em memória.
Trocar DynamoDB por Postgres é implementar as portas de novo, sem tocar em regra
de negócio. O mesmo núcleo serve o servidor local e o handler do Lambda.

**Negativas.** Há mais arquivos e uma camada de indireção que um CRUD simples
não justificaria. Cada nova dependência externa exige definir uma porta antes de
usar, o que custa alguns minutos a mais no início.

**Aceitas conscientemente.** A verbosidade é o preço da fronteira. Para uma API
com regra de negócio de segurança, que é exatamente o que está sendo avaliado, o
custo se paga na primeira suíte de testes que roda sem Docker.
