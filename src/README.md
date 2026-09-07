# Estrutura do código

Quatro camadas, uma regra: **a dependência aponta sempre para dentro**. O
domínio no centro não conhece ninguém; quem está fora depende de quem está
dentro, nunca o contrário.

Isso não é convenção de boa vontade — `npm run lint` falha quando a regra é
violada. Ver `eslint.config.js`.

```
src/
├── domain/            ← centro. Regra de negócio pura, sem I/O.
│   ├── entities/          User, Product, RefreshToken
│   ├── value-objects/     Email, PasswordHash, Money, PageCursor
│   ├── errors/            erros com `code` estável, mapeados para HTTP na borda
│   ├── ports/             interfaces que o domínio exige do mundo externo
│   └── shared/            utilitários puros usados só dentro do domínio
│
├── application/       ← casos de uso. Orquestram o domínio através das portas.
│   ├── use-cases/         AuthenticateUser, ListProducts
│   ├── session/           emissão, renovação e encerramento de sessão
│   ├── rate-limit/        política de limites e janela deslizante
│   ├── errors/            erros de aplicação, como limite excedido
│   └── dto/               entrada e saída dos casos de uso (não são schemas HTTP)
│
├── infrastructure/    ← adaptadores. Implementam as portas com tecnologia real.
│   ├── http/              Fastify: rotas, plugins, schemas zod, error handler
│   │                      (app.ts monta a instância; não sabe onde roda)
│   ├── persistence/
│   │   ├── dynamodb/      repositórios sobre a tabela única; `table.ts` guarda
│   │   │                  o desenho das chaves, que é o esquema de verdade
│   │   └── in-memory/     mesmos repositórios em memória, para teste e dev
│   ├── security/          argon2id (hash) e jose (assinatura JWT)
│   ├── observability/     log estruturado; pino e Sentry na issue #9
│   ├── system/            relógio e demais recursos da plataforma
│   └── config/            leitura e validação do ambiente
│
└── main/              ← composition root. O único lugar que enxerga tudo.
    ├── container.ts       monta o grafo de dependências
    ├── server.ts          entrypoint local
    └── lambda.ts          entrypoint AWS Lambda (issue #10)
```

## Por que as portas ficam no domínio

`UserRepository` é uma interface em `domain/ports`, não em
`infrastructure/persistence`. O domínio declara **o que precisa**; a
infraestrutura fornece. É a inversão de dependência que permite trocar DynamoDB
por Postgres sem tocar em uma linha de regra de negócio, e testar um caso de uso
inteiro sem subir container nenhum.

## O que cada camada pode importar

| De               | Pode importar                             | Pacotes de terceiros |
| ---------------- | ----------------------------------------- | -------------------- |
| `domain`         | `domain`                                  | não                  |
| `application`    | `domain`, `application`                   | não                  |
| `infrastructure` | `domain`, `application`, `infrastructure` | sim                  |
| `main`           | todas                                     | sim                  |

Módulos nativos do Node (`node:crypto`, `node:buffer`) são liberados em qualquer
camada por fazerem parte da linguagem.

A proibição de pacotes externos no núcleo é o que mantém o domínio testável em
milissegundos: nenhuma entidade sabe o que é zod, Fastify ou AWS SDK.
