# Renovação de sessão e detecção de reuso

O refresh token é rotacionado a cada uso: o antigo é marcado como substituído e
um novo par é emitido. Isso transforma o **reuso** de um token já gasto em um
sinal claro de que existe uma cópia circulando.

Quando esse sinal aparece, a resposta não é apenas recusar a requisição. Toda a
família de tokens daquela sessão é revogada, o que derruba tanto o atacante
quanto o token legítimo. É agressivo de propósito: entre manter uma sessão
possivelmente comprometida e forçar uma nova autenticação, a segunda opção é a
correta. Ver [ADR 0006](../adr/0006-jwt-e-refresh-token.md).

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente
    participant API as API
    participant UC as RefreshSession
    participant DB as DynamoDB

    Note over C,DB: Renovação normal

    C->>API: POST /v1/auth/refresh {refreshToken}
    API->>UC: executar
    UC->>UC: sha256(refreshToken)
    UC->>DB: busca por hash (chave primária)
    DB-->>UC: token válido, não substituído

    UC->>DB: UpdateItem replacedBy = novo<br/>Condition: attribute_not_exists(replacedBy)
    DB-->>UC: sucesso
    UC->>DB: grava novo refresh (mesma família)
    UC-->>API: novo par de tokens
    API-->>C: 200 accessToken + refreshToken

    Note over C,DB: Reuso de token já rotacionado

    C->>API: POST /v1/auth/refresh {token antigo}
    API->>UC: executar
    UC->>DB: busca por hash
    DB-->>UC: token com replacedBy preenchido

    rect rgb(253, 226, 226)
        UC->>UC: reuso detectado
        UC->>DB: revoga a família inteira<br/>Query GSI1 por familyId
        UC->>UC: log auth.refresh.reuse_detected<br/>+ métrica de segurança
    end

    UC-->>API: RefreshTokenReuseDetectedError
    API-->>C: 401 REFRESH_TOKEN_INVALID

    Note over C,DB: O token emitido na renovação anterior<br/>também deixa de valer
```
