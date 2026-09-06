# Códigos de erro

Todo erro previsto da aplicação carrega um `code` estável. É ele — e não a
mensagem — que o cliente usa para decidir o que fazer: mensagem é para humano e
pode mudar a qualquer momento, código é contrato.

O registro fica em [`src/domain/errors/error-code.ts`](../src/domain/errors/error-code.ts).
Manter a lista fechada num só lugar permite que o tradutor de erro em HTTP
(issue #8) seja exaustivo: acrescentar um código sem mapeá-lo vira erro de
compilação, em vez de virar um 500 genérico descoberto em produção.

## Tabela

| Código                         | Classe                           | HTTP | Exposto ao cliente                |
| ------------------------------ | -------------------------------- | ---- | --------------------------------- |
| `VALIDATION_ERROR`             | `ValidationError`                | 400  | sim                               |
| `INVALID_CURSOR`               | `InvalidCursorError`             | 400  | sim                               |
| `INVALID_CREDENTIALS`          | `InvalidCredentialsError`        | 401  | sim                               |
| `ACCOUNT_LOCKED`               | `AccountLockedError`             | —    | **não** → `INVALID_CREDENTIALS`   |
| `REFRESH_TOKEN_INVALID`        | `InvalidRefreshTokenError`       | 401  | sim                               |
| `REFRESH_TOKEN_REUSE_DETECTED` | `RefreshTokenReuseDetectedError` | —    | **não** → `REFRESH_TOKEN_INVALID` |
| `CONCURRENT_MODIFICATION`      | `ConcurrencyError`               | —    | **não** → depende do caso de uso  |
| `RATE_LIMIT_EXCEEDED`          | `RateLimitExceededError`         | 429  | sim                               |

## Por que três erros nunca chegam ao cliente

A coluna "exposto" não é detalhe de implementação. Ela carrega as decisões de
segurança do projeto, e mudá-la reabre vulnerabilidades fechadas de propósito.

**`ACCOUNT_LOCKED`.** Responder que a conta está bloqueada confirma que aquele
e-mail existe, e permite que qualquer pessoa bloqueie a conta de outra apenas
errando a senha cinco vezes. Usuário inexistente, senha errada e conta bloqueada
recebem a mesma resposta, com o mesmo corpo e o mesmo tempo. Ver
[ADR 0010](adr/0010-lockout-indistinguivel.md).

**`REFRESH_TOKEN_REUSE_DETECTED`.** Avisar que o reuso foi percebido informaria
ao atacante que ele foi detectado, e a reação — revogar a família inteira — é
mais útil do que a notificação. Ver [ADR 0006](adr/0006-jwt-e-refresh-token.md).

**`CONCURRENT_MODIFICATION`.** É a persistência dizendo que o registro mudou
embaixo, não uma decisão de negócio. O caso de uso escolhe o que fazer: no login,
a escolha é **não** repetir a tentativa, porque insistir numa tentativa
malsucedida ajudaria quem está atacando.

## Formato da resposta

A borda HTTP (issue #8) traduz cada erro para
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457), acrescentando o identificador
da requisição para permitir seguir o caso do cliente até o log e o Sentry:

```json
{
  "type": "https://ton-swe-challenge/errors/invalid-credentials",
  "title": "Credenciais inválidas.",
  "status": 401,
  "code": "INVALID_CREDENTIALS",
  "instance": "/v1/auth/login",
  "requestId": "01JP2K9Z8H4T6QW3RN5XC7BVDE"
}
```

O campo `details` que os erros carregam internamente **não** entra na resposta:
ele existe para log e depuração, e costuma conter exatamente o que não deve ser
devolvido, como o instante em que um bloqueio expira.

## Hierarquia

```
AppError                      erro previsto, código estável, sem alerta no Sentry
├── DomainError               a regra de negócio disse não
│   ├── ValidationError
│   ├── InvalidCursorError
│   ├── InvalidCredentialsError
│   ├── AccountLockedError
│   ├── InvalidRefreshTokenError
│   └── RefreshTokenReuseDetectedError
├── ConcurrencyError          a persistência perdeu uma corrida
└── RateLimitExceededError    política operacional (vive em application/errors)
```

Qualquer exceção que **não** estenda `AppError` é falha não prevista: vira 500,
gera evento no Sentry e não tem detalhe algum devolvido ao cliente.
