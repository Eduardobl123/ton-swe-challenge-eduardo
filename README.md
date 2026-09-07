# Ton SWE Challenge — API de autenticação e catálogo

[![CI](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/actions/workflows/ci.yml/badge.svg)](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/actions/workflows/ci.yml)

API REST que autentica usuários por JWT e expõe uma listagem de produtos
protegida, paginada por cursor e com rate limit. Construída em arquitetura
hexagonal sobre Node.js e TypeScript, persistida em DynamoDB e provisionada com
Terraform.

Resposta ao desafio técnico back-end da Ton/Stone.

---

## Status da implementação

O trabalho está fatiado em issues, cada uma com escopo, critérios de aceite e
riscos. Esta tabela é a fonte de verdade sobre o que já roda.

| #                                                                         | Entrega                                      | Status      |
| ------------------------------------------------------------------------- | -------------------------------------------- | ----------- |
| [1](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/1)   | Bootstrap, tooling e fronteiras hexagonais   | ✅ pronto   |
| [2](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/2)   | Domínio: entidades, value objects e portas   | ✅ pronto   |
| [3](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/3)   | Login com argon2id, JWT e lockout            | ✅ pronto   |
| [4](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/4)   | Refresh token rotativo com detecção de reuso | ✅ pronto   |
| [5](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/5)   | Listagem paginada por cursor                 | ✅ pronto   |
| [6](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/6)   | Rate limit por usuário e por IP              | ✅ pronto   |
| [7](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/7)   | Persistência DynamoDB e ambiente local       | ✅ pronto   |
| [8](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/8)   | Adaptador HTTP Fastify e OpenAPI             | ✅ pronto   |
| [9](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/9)   | Observabilidade: logs, request-id e Sentry   | ✅ pronto   |
| [10](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/10) | Infraestrutura AWS com Terraform             | ✅ pronto   |
| [11](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/11) | CI/CD e gate de cobertura                    | ✅ pronto   |
| [12](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/12) | Documentação, ADRs e diagramas               | 🔄 em curso |
| [13](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/13) | Testes ponta a ponta e contrato              | ⏳ pendente |

---

## Arquitetura

O domínio fica no centro e não conhece nada externo. Casos de uso o orquestram
através de **portas** — interfaces declaradas pelo próprio domínio. Adaptadores
implementam essas portas com tecnologia concreta. Trocar DynamoDB por Postgres,
ou Fastify por Express, não toca em uma linha de regra de negócio.

```mermaid
flowchart LR
    subgraph driving["Adaptadores de entrada"]
        HTTP["Fastify<br/>rotas + zod"]
        LAMBDA["AWS Lambda<br/>handler"]
    end

    subgraph core["Núcleo — sem I/O, sem pacotes de terceiros"]
        direction TB
        APP["Aplicação<br/>AuthenticateUser · RefreshSession · ListProducts"]
        DOM["Domínio<br/>User · Product · RefreshToken<br/>Email · Money · LockoutPolicy"]
        APP --> DOM
    end

    subgraph ports["Portas (interfaces do domínio)"]
        P1["UserRepository"]
        P2["ProductRepository"]
        P3["RefreshTokenRepository"]
        P4["PasswordHasher"]
        P5["TokenSigner"]
        P6["RateLimiterStore"]
        P7["Clock · IdGenerator"]
    end

    subgraph driven["Adaptadores de saída"]
        DDB["DynamoDB<br/>tabela única"]
        ARGON["argon2id"]
        JOSE["jose (JWT)"]
        OBS["pino · Sentry"]
    end

    HTTP --> APP
    LAMBDA --> HTTP
    APP -.depende de.-> ports
    DDB -.implementa.-> P1 & P2 & P3 & P6
    ARGON -.implementa.-> P4
    JOSE -.implementa.-> P5
    OBS --> HTTP
```

A regra de dependência é verificada por lint, não por disciplina:
`npm run lint` falha se `domain/` ou `application/` importarem de
`infrastructure/` ou de qualquer pacote de terceiros.

Detalhes em [`src/README.md`](src/README.md). Diagramas de fluxo em
[`docs/diagrams/`](docs/diagrams/).

### Infraestrutura alvo

```mermaid
flowchart LR
    C["Cliente"] --> AGW["API Gateway HTTP API<br/>throttle de borda"]
    AGW --> L["Lambda<br/>Node 24 · arm64 · 512 MB"]
    L --> D[("DynamoDB<br/>tabela única · TTL · GSI1")]
    L --> SSM["SSM Parameter Store<br/>JWT_SECRET · SENTRY_DSN"]
    L --> CW["CloudWatch<br/>logs JSON · métricas EMF"]
    L --> S["Sentry<br/>erros 5xx"]
```

---

## Como rodar localmente

Pré-requisitos: **Node 24** (`nvm use` lê o `.nvmrc`) e Docker, este último a
partir da issue #7.

```bash
git clone https://github.com/Eduardobl123/ton-swe-challenge-eduardo.git
cd ton-swe-challenge-eduardo

nvm use              # Node 24.20.0
npm ci               # instala e prepara os hooks de commit
cp .env.example .env # ajuste o JWT_SECRET antes de subir

npm run dev          # valida a configuração e sobe o servidor
```

A API sobe com dados de demonstração já carregados, então dá para exercitá-la
imediatamente. Se faltar uma variável ou o `JWT_SECRET` for curto demais, a
aplicação lista o que corrigir e encerra, em vez de subir quebrada.

Documentação interativa em `http://localhost:3000/docs`.
Usuário de demonstração: `demo@ton.com.br` / `Desafio@Ton2026`.

Gere um segredo real com:

```bash
openssl rand -base64 48
```

### Com DynamoDB de verdade

O modo padrão usa dados em memória, o que dispensa Docker. Para exercitar a
persistência real:

```bash
docker compose up -d        # DynamoDB Local
npm run db:create           # cria a tabela a partir de infra/table-schema.json
npm run db:seed             # 1 usuário e 250 produtos, idempotente

PERSISTENCE=dynamodb npm run dev
```

O mesmo `npm run db:seed` roda contra a AWS: basta não definir
`DYNAMODB_ENDPOINT`. Ter um script separado para produção faria dele o que
ninguém executa até a hora da entrega, que é justamente quando falharia.

```bash
npm run test:integration    # 45 testes contra o banco de verdade
```

Eles provam o que duplo nenhum prova: escrita condicionada por versão,
incremento atômico do contador e rotação transacional do refresh token, cada um
com o caso de cem operações simultâneas.

### Exercitando a API

```bash
# 1. login — devolve access token e refresh token
TOKENS=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@ton.com.br","password":"Desafio@Ton2026"}')

ACCESS=$(echo "$TOKENS"  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
REFRESH=$(echo "$TOKENS" | sed -n 's/.*"refreshToken":"\([^"]*\)".*/\1/p')

# 2. listagem protegida e paginada
curl -s 'http://localhost:3000/v1/products?limit=5' -H "authorization: Bearer $ACCESS"

# 3. renovação — o refresh token apresentado deixa de valer
curl -s -X POST http://localhost:3000/v1/auth/refresh \
  -H 'content-type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}"

# 4. encerrar a sessão
curl -s -X POST http://localhost:3000/v1/auth/logout \
  -H 'content-type: application/json' -H "authorization: Bearer $ACCESS" \
  -d "{\"refreshToken\":\"$REFRESH\"}"
```

Alguns comportamentos que valem observar:

- Senha errada e conta inexistente devolvem **exatamente** a mesma resposta.
- Reapresentar um refresh token já usado derruba a sessão inteira, inclusive o
  token emitido na renovação.
- A listagem devolve `RateLimit-Limit` e `RateLimit-Remaining` mesmo quando a
  requisição passa. Estourando a cota, o `Retry-After` indica quando a cota de
  fato volta, não o fim do minuto.
- Todo erro segue a RFC 9457 e carrega `code` e `requestId`.

O contrato completo está em [`docs/openapi.json`](docs/openapi.json), gerado por
`npm run openapi:export`.

---

## Variáveis de ambiente

Todas são validadas na subida por [`src/infrastructure/config/env.ts`](src/infrastructure/config/env.ts).
A aplicação recusa iniciar com configuração inválida, em vez de falhar na
primeira requisição. A referência completa e comentada está em
[`.env.example`](.env.example).

| Variável                         | Obrigatória | Padrão                  | Para que serve                                      |
| -------------------------------- | ----------- | ----------------------- | --------------------------------------------------- |
| `NODE_ENV`                       | não         | `development`           | Formato de log e exposição do Swagger               |
| `PORT`                           | não         | `3000`                  | Porta HTTP local                                    |
| `LOG_LEVEL`                      | não         | `info`                  | Nível mínimo de log                                 |
| `APP_VERSION`                    | não         | `local`                 | Versão nos logs e no Sentry (SHA do commit no CI)   |
| `JWT_SECRET`                     | **sim**     | —                       | Segredo HMAC, mínimo de 32 caracteres               |
| `JWT_ISSUER`                     | não         | `ton-swe-challenge`     | Claim `iss`, validada na verificação                |
| `JWT_AUDIENCE`                   | não         | `ton-swe-challenge-api` | Claim `aud`, validada na verificação                |
| `JWT_ACCESS_TTL_SECONDS`         | não         | `900`                   | Validade do access token                            |
| `REFRESH_TOKEN_TTL_SECONDS`      | não         | `604800`                | Validade do refresh token                           |
| `LOCKOUT_MAX_ATTEMPTS`           | não         | `5`                     | Tentativas erradas antes do bloqueio                |
| `LOCKOUT_BASE_DELAY_MS`          | não         | `30000`                 | Primeiro bloqueio, com backoff exponencial          |
| `LOCKOUT_MAX_DELAY_MS`           | não         | `900000`                | Teto do bloqueio, para não virar negação de serviço |
| `AWS_REGION`                     | não         | `us-east-1`             | Região do DynamoDB                                  |
| `TABLE_NAME`                     | **sim**     | —                       | Tabela única do DynamoDB                            |
| `DYNAMODB_ENDPOINT`              | não         | —                       | Aponta para o DynamoDB Local; vazio usa a AWS real  |
| `RATE_LIMIT_PRODUCTS_PER_MINUTE` | não         | `60`                    | Cota por usuário na listagem                        |
| `RATE_LIMIT_LOGIN_PER_MINUTE`    | não         | `10`                    | Cota por IP no login                                |
| `RATE_LIMIT_REFRESH_PER_MINUTE`  | não         | `20`                    | Cota por IP na renovação de sessão                  |
| `RATE_LIMIT_FAIL_OPEN`           | não         | `true`                  | Se o contador falhar, libera em vez de recusar      |
| `CORS_ORIGINS`                   | não         | `*`                     | Origens permitidas, separadas por vírgula           |
| `SWAGGER_ENABLED`                | não         | `true`                  | Expõe `/docs`                                       |
| `SENTRY_DSN`                     | não         | —                       | Vazio desliga o Sentry                              |
| `SENTRY_TRACES_SAMPLE_RATE`      | não         | `0.1`                   | Fração de transações rastreadas                     |

---

## Testes

```bash
npm test              # unitários — rápidos, sem Docker
npm run test:coverage # unitários com relatório de cobertura
npm run test:integration  # contra o DynamoDB Local (issue #7)
npm run test:e2e          # jornadas completas (issue #13)
```

A pirâmide é deliberada. O núcleo tem gate de cobertura de 90% porque é código
puro, sem I/O, onde não existe desculpa para não cobrir. Adaptadores ficam com
os testes de integração, e as jornadas de ponta a ponta cobrem a composição.

Relatório HTML em `coverage/index.html` após `npm run test:coverage`.

---

## Integração contínua

Cada push e cada pull request rodam sete verificações em paralelo:

| Verificação           | O que impede de entrar                                                      |
| --------------------- | --------------------------------------------------------------------------- |
| Tipos, lint e formato | Fronteira arquitetural violada, promessa não tratada, código fora de padrão |
| Testes unitários      | Regressão no núcleo, com gate de 90% de cobertura em domínio e aplicação    |
| Testes de integração  | Quebra nas garantias de concorrência, contra o DynamoDB de verdade          |
| Contrato OpenAPI      | Rota alterada sem atualizar `docs/openapi.json`                             |
| Build                 | Pacote que não compila, com o tamanho reportado a cada execução             |
| Vulnerabilidades      | Dependência com falha de severidade alta ou crítica                         |
| Infraestrutura        | Terraform malformado ou inválido                                            |

A verificação de infraestrutura se declara ausente enquanto não houver arquivos
`.tf`, e passa a validar sozinha quando a issue #10 os criar — cada módulo por
vez, porque `infra/` guarda apenas subdiretórios.

A auditoria de dependências relata em vez de bloquear. Um aviso publicado sobre
dependência transitiva reprovaria o próximo pull request seja ele qual for, o
autor não teria o que corrigir, e a lição aprendida seria ignorar a esteira
vermelha.

O deploy é manual, por `workflow_dispatch`, e usa federação por OIDC em vez de
chave de acesso guardada como segredo: chave estática vaza, não expira e
ninguém percebe quando é usada. Sem a role configurada nas variáveis do
repositório, o fluxo se declara indisponível em vez de falhar no meio.

### Rodando o mesmo que o CI roda

```bash
npm run typecheck && npm run lint && npm run format:check
npm run test:coverage
docker compose up -d --wait && npm run test:integration
```

## Qualidade de código

```bash
npm run typecheck      # tsc em modo strict
npm run lint           # ESLint, incluindo as fronteiras arquiteturais
npm run format         # Prettier
npm run openapi:export # regenera docs/openapi.json a partir das rotas
```

O TypeScript roda com `strict`, `noUncheckedIndexedAccess` e
`exactOptionalPropertyTypes`. O ESLint bloqueia promessas não tratadas e
importações que quebrem a direção da dependência entre camadas. Um hook de
pre-commit roda lint e formatação apenas nos arquivos alterados.

---

## Observabilidade

### Da reclamação até a causa, em três saltos

Alguém relata que uma requisição falhou e traz o `x-request-id` que veio na
resposta. Com ele:

```bash
# 1. a linha da requisição, com rota, status, duração e usuário
aws logs filter-log-events --log-group-name /aws/lambda/ton-challenge \
  --filter-pattern '{ $.requestId = "01JP2K…" }'

# 2. no Sentry, a mesma etiqueta leva ao evento com a pilha
#    requestId:01JP2K…
```

O identificador é aceito da entrada quando o cliente já traz um, o que permite
seguir a requisição através de mais de um serviço, e devolvido no cabeçalho de
toda resposta.

### Log

JSON de uma linha, escrito no stdout e recolhido pelo CloudWatch sem agente.
Toda linha carrega ambiente e versão, então achar as requisições de uma
implantação específica não exige correlacionar com o histórico de deploy.

O nome do evento vem primeiro e é estável: `auth.login.failed` é agregável e
alertável, enquanto uma frase muda quando alguém a reescreve e leva o alarme
junto.

Senha, hash, token e cabeçalho de autorização são removidos por configuração,
no campo direto e em um nível de aninhamento. Antes disso, porém, o próprio tipo
dos campos de log aceita apenas valores primitivos: passar uma entidade ou um
`PasswordHash` para o log **não compila**. O vazamento acidental deixa de
depender da atenção de quem escreve a chamada, e a remoção fica como segunda
linha para o que bibliotecas anexam por conta própria.

### Métricas

Publicadas no formato embutido do CloudWatch, pela mesma escrita no stdout que
já acontece — sem chamada de rede no caminho da requisição.

| Métrica                         | Dimensões | Para quê                                         |
| ------------------------------- | --------- | ------------------------------------------------ |
| `RequestDuration`               | rota      | Latência por rota, base do alarme de p99         |
| `LoginSuccess` / `LoginFailure` | —         | Proporção de falha, que denuncia ataque em curso |
| `RateLimited`                   | rota      | Quanto a cota está mordendo                      |
| `ServerError`                   | rota      | Base do alarme de 5xx                            |

A dimensão é sempre o padrão da rota, nunca a URL: a URL traz o cursor de
paginação, e uma dimensão de cardinalidade infinita vira uma série temporal por
requisição.

### Relato de erro

Só falha imprevista chega ao Sentry. Credencial inválida, limite excedido e
token expirado são resultados previstos, e enviá-los encheria o alerta de
eventos cotidianos até ninguém mais olhar para ele.

O evento leva o identificador da requisição, a rota e o identificador do
usuário — nunca o e-mail. Cabeçalhos, cookies e corpo são removidos antes do
envio. Sem DSN configurado a aplicação sobe normalmente, o que mantém
desenvolvimento e CI limpos.

---

## Deploy na AWS

API Gateway HTTP à frente de uma função Lambda em arm64, com DynamoDB como banco
e segredos no Parameter Store. Tudo por Terraform, com permissões de menor
privilégio: nenhuma declaração usa `*` em recurso ou em ação.

```bash
npm run package:lambda
cd infra/envs/dev && export TF_VAR_jwt_secret=$(openssl rand -base64 48)
terraform init && terraform apply
```

Passo a passo, verificação por `curl` e limpeza em [`infra/README.md`](infra/README.md).

O segredo é lido do Parameter Store **uma vez por instância**, no carregamento
do módulo, e não a cada requisição — buscar por chamada colocaria a latência do
SSM dentro do p99 de toda resposta.

---

## Decisões técnicas

As escolhas relevantes estão registradas como ADRs em [`docs/adr/`](docs/adr/),
cada uma com contexto, alternativas descartadas e consequências. Os códigos de
erro e quais deles nunca chegam ao cliente estão em
[`docs/errors.md`](docs/errors.md).

| ADR                                                 | Decisão                                                  |
| --------------------------------------------------- | -------------------------------------------------------- |
| [0001](docs/adr/0001-arquitetura-hexagonal.md)      | Arquitetura hexagonal com composition root manual        |
| [0002](docs/adr/0002-fastify-e-zod.md)              | Fastify com zod como fonte única de validação e OpenAPI  |
| [0003](docs/adr/0003-dynamodb-tabela-unica.md)      | DynamoDB em tabela única                                 |
| [0004](docs/adr/0004-paginacao-por-cursor.md)       | Paginação por cursor, sem contagem total                 |
| [0005](docs/adr/0005-rate-limit-em-duas-camadas.md) | Rate limit em duas camadas, janela deslizante, fail-open |
| [0006](docs/adr/0006-jwt-e-refresh-token.md)        | JWT curto com refresh rotativo e detecção de reuso       |
| [0007](docs/adr/0007-argon2id.md)                   | argon2id para hash de senha                              |
| [0008](docs/adr/0008-lambda-em-vez-de-fargate.md)   | Lambda com API Gateway em vez de ECS Fargate             |
| [0009](docs/adr/0009-observabilidade.md)            | pino, Sentry e métricas EMF                              |
| [0010](docs/adr/0010-lockout-indistinguivel.md)     | Bloqueio de conta indistinguível de credencial inválida  |
| [0011](docs/adr/0011-versionamento-da-api.md)       | Versionamento da API por prefixo `/v1`                   |

---

## Uso de inteligência artificial

O desafio pede que o uso de IA, se houver, seja estruturado. Ele foi, e o
processo está descrito em [`AI_USAGE.md`](AI_USAGE.md): planejamento em issues
com critérios de aceite, skills versionadas em `.claude/`, revisão adversarial
do próprio plano e o que foi rejeitado e por quê.

---

## Roadmap

O que faria com mais tempo, em ordem de valor:

1. **Trocar o rate limit para Redis.** Uma escrita no DynamoDB por requisição
   funciona e é atômica, mas custa mais que o necessário em volume alto.
2. **Migrar o JWT para ES256 com JWKS.** O HS256 exige compartilhar o segredo
   com todo verificador; chave assimétrica permite validar sem poder assinar.
3. **Sharding da partição de produtos ativos.** O `GSI1PK` único vira ponto
   quente se o catálogo crescer muito.
4. **Testes de mutação** com Stryker no núcleo, para medir a qualidade dos
   testes e não apenas a cobertura.
5. **Cache de leitura** na listagem, com invalidação por escrita.

---

## Licença

[MIT](LICENSE).
