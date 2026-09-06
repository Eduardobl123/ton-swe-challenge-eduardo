# ADR 0005 — Rate limit em duas camadas, janela deslizante, fail-open

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#6](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/6)

## Contexto

O enunciado pede "algum mecanismo de rate-limit para lidar com um volume
significativo de requisições". A aplicação roda em Lambda (ADR 0008): não há
estado entre invocações e várias instâncias atendem em paralelo, o que descarta
qualquer contador em memória do processo.

Há também dois alvos distintos a proteger. O login precisa de limite por origem,
porque ainda não há usuário identificado e é onde acontece força bruta. A
listagem precisa de limite por usuário autenticado, porque limitar por endereço
puniria todos os clientes atrás de um mesmo NAT.

## Decisão

Duas camadas complementares.

**Na borda**, o throttle nativo do API Gateway com limites de taxa e rajada por
estágio. É barato, não consome invocação de Lambda e absorve tempestade de
tráfego antes que ela chegue à aplicação.

**Na aplicação**, um contador de janela deslizante atrás da porta
`RateLimiterStore`, com chave `user:<id>` nas rotas autenticadas e `ip:<addr>`
no login e na renovação de sessão. O adaptador DynamoDB usa `UpdateItem` com
`ADD` — uma escrita atômica, sem leitura prévia — e TTL para expurgo.

A resposta traz os cabeçalhos `RateLimit-Limit`, `RateLimit-Remaining` e
`RateLimit-Reset`, além de `Retry-After` no 429.

Se o armazenamento do contador falhar, a requisição **passa** (`fail-open`),
registrando o evento. O comportamento é configurável.

## Alternativas consideradas

**Apenas o throttle do API Gateway.** Simples e sem custo de código. Descartado
porque o limite é global por estágio: um único cliente abusivo consumiria a cota
de todos, e não há como diferenciar cota de login de cota de listagem.

**Janela fixa.** Um contador por minuto cheio. Descartada pelo efeito de borda:
um cliente pode emitir o dobro do limite na virada da janela, concentrando a
rajada exatamente onde ela mais dói.

**Token bucket com registro de timestamps.** Mais preciso. Descartado porque
exigiria guardar e podar uma lista por chave, transformando uma escrita atômica
em leitura, modificação e escrita — mais caro e sujeito a corrida.

**ElastiCache com Redis.** É a escolha certa em produção de alto volume.
Descartado aqui porque exige VPC, subnets e um custo fixo por hora que não se
justifica num desafio, além de acoplar a Lambda à rede privada e piorar o cold
start.

**Falhar fechado (`fail-closed`).** Descartado como padrão: uma instabilidade no
DynamoDB derrubaria a API inteira com 429, transformando um problema de
dependência em indisponibilidade total. Proteção contra abuso não vale
indisponibilidade para quem está usando corretamente — e a camada de borda
continua ativa nesse cenário.

## Consequências

**Positivas.** Cotas independentes por rota e por identidade. Contador atômico
sem corrida. Uma falha do contador degrada a proteção, não o serviço.

**Negativas.** Uma escrita no DynamoDB por requisição tem custo real e adiciona
alguns milissegundos de latência. A janela deslizante é uma aproximação
ponderada de duas janelas fixas, não um cálculo exato.

**Gatilho para revisar.** Se o volume tornar o custo por requisição relevante,
migrar a porta `RateLimiterStore` para Redis. A interface não muda.
