# Listagem de produtos

A rota protegida junta três mecanismos: verificação do token sem tocar no banco,
cota por usuário autenticado e paginação por cursor.

A ordem importa. O token é verificado **antes** do rate limit, porque a chave da
cota é o identificador do usuário — limitar por endereço numa rota autenticada
puniria todos os clientes atrás de um mesmo NAT. Ver
[ADR 0005](../adr/0005-rate-limit-em-duas-camadas.md).

O cursor é opaco e assinado. O cliente o devolve como recebeu, sem saber que
dentro dele está a chave de continuação do DynamoDB. Ver
[ADR 0004](../adr/0004-paginacao-por-cursor.md).

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente
    participant AGW as API Gateway
    participant API as Fastify
    participant UC as ListProducts
    participant DB as DynamoDB

    C->>AGW: GET /v1/products?limit=20&cursor=…
    AGW->>AGW: throttle de borda (taxa e rajada)
    AGW->>API: encaminha

    API->>API: verifica JWT (jose)<br/>iss, aud, exp, algoritmo fixo
    alt token ausente ou inválido
        API-->>C: 401 UNAUTHENTICATED
    end

    API->>DB: UpdateItem ADD contador<br/>chave user:<id>, janela de 1 min
    DB-->>API: contador atual
    alt acima da cota
        API-->>C: 429 + Retry-After<br/>RateLimit-Remaining: 0
    end

    API->>API: valida query com zod<br/>limit entre 1 e 100
    API->>UC: executar {limit, cursor}
    UC->>UC: decodifica e confere HMAC do cursor
    alt cursor adulterado
        UC-->>C: 400 INVALID_CURSOR
    end

    UC->>DB: Query GSI1 PRODUCT#ACTIVE<br/>ExclusiveStartKey, Limit
    DB-->>UC: itens + LastEvaluatedKey
    UC->>UC: mapeia para o domínio<br/>gera o próximo cursor
    UC-->>API: {data, page}
    API-->>C: 200 + RateLimit-Remaining
```
