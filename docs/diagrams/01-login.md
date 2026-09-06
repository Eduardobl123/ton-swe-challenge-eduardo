# Fluxo de login

O ponto central deste diagrama é que **três caminhos diferentes terminam na
mesma resposta**: e-mail inexistente, senha errada e conta bloqueada produzem um
`401 INVALID_CREDENTIALS` idêntico, com o mesmo corpo e o mesmo tempo de
resposta.

Isso é deliberado. Uma resposta distinta para conta bloqueada permitiria
descobrir quais e-mails existem, e permitiria bloquear a conta de terceiros de
propósito. O raciocínio completo está no [ADR 0010](../adr/0010-lockout-indistinguivel.md).

A verificação contra um hash inerte quando o usuário não existe serve ao mesmo
propósito no eixo do tempo: sem ela, a resposta mais rápida denunciaria que o
e-mail não está cadastrado.

```mermaid
flowchart TD
    A["POST /v1/auth/login"] --> B{"Rate limit por IP<br/>dentro da cota?"}
    B -- não --> R429["429<br/>RATE_LIMIT_EXCEEDED<br/>+ Retry-After"]
    B -- sim --> C{"Corpo válido?<br/>e-mail e senha de 8 a 128"}
    C -- não --> R400["400<br/>VALIDATION_ERROR"]
    C -- sim --> D["Busca usuário por e-mail<br/>Query no GSI1"]

    D --> E{"Usuário existe?"}
    E -- não --> F["Verifica contra hash inerte<br/>(equaliza o tempo)"]
    F --> R401

    E -- sim --> G{"Conta bloqueada?<br/>lockedUntil > agora"}
    G -- sim --> H["Verifica contra hash inerte<br/>registra auth.login.locked"]
    H --> R401

    G -- não --> I["Verifica senha<br/>argon2id"]
    I --> J{"Senha confere?"}

    J -- não --> K["recordFailedLogin<br/>backoff exponencial, teto de 15 min"]
    K --> L["save com version<br/>optimistic locking"]
    L --> R401

    J -- sim --> M["recordSuccessfulLogin<br/>zera o contador"]
    M --> N["Emite access token<br/>JWT HS256, 15 min"]
    N --> O["Emite refresh token<br/>256 bits, só o hash é salvo"]
    O --> R200["200<br/>accessToken, refreshToken, expiresIn"]

    R401["401<br/>INVALID_CREDENTIALS<br/>resposta idêntica nos três casos"]

    style R401 fill:#fde2e2,stroke:#c92a2a
    style R200 fill:#e3fafc,stroke:#0b7285
    style R429 fill:#fff4e6,stroke:#e8590c
    style R400 fill:#fff4e6,stroke:#e8590c
```
