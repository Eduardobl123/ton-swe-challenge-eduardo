# ADR 0002 — Fastify com zod como fonte única de validação e OpenAPI

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#8](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/8)

## Contexto

A API precisa validar entrada, documentar-se em OpenAPI e rodar em Lambda, onde
cada milissegundo de inicialização aparece no p99. O desafio trata documentação
OpenAPI como diferencial explícito.

Documentação escrita à mão desatualiza silenciosamente: o schema diverge da
implementação e ninguém percebe até o consumidor quebrar.

## Decisão

Fastify 5 com `fastify-type-provider-zod`. Um único schema zod por rota gera, ao
mesmo tempo, a validação em runtime, o tipo estático do handler e a entrada
correspondente no documento OpenAPI 3.1, publicado por `@fastify/swagger`.

O `docs/openapi.json` é exportado e versionado. O CI regenera e compara: se a
API mudou sem atualizar o documento, o build falha.

## Alternativas consideradas

**Express.** Ecossistema maior e mais conhecido. Descartado porque validação e
OpenAPI exigem bibliotecas separadas que não conversam entre si, o que reabre a
porta para a divergência entre schema e código. O desempenho também é
sensivelmente inferior sob carga.

**NestJS.** Traz injeção de dependência, módulos e geração de OpenAPI prontos.
Descartado por dois motivos: o custo de inicialização pesa no cold start do
Lambda, e o modelo de decorators tende a puxar o framework para dentro da camada
de negócio, o que conflita diretamente com a fronteira definida no ADR 0001.

**Fastify com JSON Schema puro.** É o formato nativo do Fastify e dispensa o
type provider. Descartado porque JSON Schema não gera tipos estáticos, forçando
manter interface TypeScript e schema em sincronia manual.

## Consequências

**Positivas.** Schema, tipo e documentação nunca divergem, porque são a mesma
declaração. A validação de resposta pega regressão de contrato em teste. O
`app.inject()` do Fastify permite testar rotas sem abrir porta de rede.

**Negativas.** `fastify-type-provider-zod` é uma dependência de comunidade, não
oficial, e acompanha as versões maiores do Fastify com algum atraso. Mensagens
de erro do zod precisam ser traduzidas para o formato de erro da API.

**Mitigação.** O tratamento de erro é centralizado em um único handler, o que
concentra a tradução em um lugar só.
