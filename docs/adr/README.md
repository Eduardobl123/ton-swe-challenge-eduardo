# Registros de decisão de arquitetura

Cada arquivo aqui registra uma decisão técnica relevante: o contexto em que foi
tomada, o que foi decidido, o que foi descartado e o preço que se paga por isso.

O formato é [MADR](https://adr.github.io/madr/) enxuto. A intenção é que alguém
que chegue ao projeto daqui a seis meses entenda **por que** ele é assim, e não
apenas como ele é — a parte que o código não conta.

| ADR                                        | Decisão                                                  | Status |
| ------------------------------------------ | -------------------------------------------------------- | ------ |
| [0001](0001-arquitetura-hexagonal.md)      | Arquitetura hexagonal com composition root manual        | Aceita |
| [0002](0002-fastify-e-zod.md)              | Fastify com zod como fonte única de validação e OpenAPI  | Aceita |
| [0003](0003-dynamodb-tabela-unica.md)      | DynamoDB em tabela única                                 | Aceita |
| [0004](0004-paginacao-por-cursor.md)       | Paginação por cursor, sem contagem total                 | Aceita |
| [0005](0005-rate-limit-em-duas-camadas.md) | Rate limit em duas camadas, janela deslizante, fail-open | Aceita |
| [0006](0006-jwt-e-refresh-token.md)        | JWT curto com refresh rotativo e detecção de reuso       | Aceita |
| [0007](0007-argon2id.md)                   | argon2id para hash de senha                              | Aceita |
| [0008](0008-lambda-em-vez-de-fargate.md)   | Lambda com API Gateway em vez de ECS Fargate             | Aceita |
| [0009](0009-observabilidade.md)            | pino, Sentry e métricas EMF                              | Aceita |
| [0010](0010-lockout-indistinguivel.md)     | Bloqueio de conta indistinguível de credencial inválida  | Aceita |
| [0011](0011-versionamento-da-api.md)       | Versionamento da API por prefixo `/v1`                   | Aceita |
