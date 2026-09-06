# ADR 0003 — DynamoDB em tabela única

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#7](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/7)

## Contexto

O desafio aceita quatro bancos e destaca DynamoDB como diferencial. Os padrões
de acesso da aplicação são poucos e conhecidos de antemão:

1. buscar usuário por e-mail (login);
2. listar produtos ativos, ordenados e paginados;
3. buscar refresh token pelo seu hash;
4. revogar todos os tokens de uma família;
5. incrementar um contador de rate limit por chave e janela.

Nenhum deles exige junção ou consulta ad-hoc.

## Decisão

Uma única tabela com chave composta `PK`/`SK` e um índice global `GSI1`,
abrigando as quatro entidades:

| Entidade     | PK                    | SK        | GSI1PK            | GSI1SK             | TTL         |
| ------------ | --------------------- | --------- | ----------------- | ------------------ | ----------- |
| User         | `USER#<id>`           | `PROFILE` | `EMAIL#<email>`   | `USER`             | —           |
| Product      | `PRODUCT#<id>`        | `PROFILE` | `PRODUCT#ACTIVE`  | `<createdAt>#<id>` | —           |
| RefreshToken | `RT#<sha256>`         | `TOKEN`   | `RTFAM#<família>` | `<createdAt>`      | `expiresAt` |
| RateLimit    | `RL#<chave>#<janela>` | `COUNTER` | —                 | —                  | `fim + 60s` |

Cobrança sob demanda, TTL nativo para expurgo e nenhuma operação de `Scan` no
código de produção — verificado por uma checagem no CI.

## Alternativas consideradas

**Uma tabela por entidade.** Mais legível para quem vem de banco relacional.
Descartada porque multiplica o Terraform e as permissões de IAM sem trazer
benefício: os padrões de acesso continuam sendo consultas por chave.

**PostgreSQL no RDS.** Traria junções, contagem total barata e `OFFSET`.
Descartado porque exige VPC, subnets e gestão de pool de conexões a partir do
Lambda — desproporcional para cinco padrões de acesso, e mais caro que o
free tier do DynamoDB.

**MongoDB Atlas.** Modelo de documento confortável. Descartado por adicionar um
provedor externo à conta AWS e sair do que o enunciado destaca como diferencial.

## Consequências

**Positivas.** Latência previsível, escala sem gestão de servidor, custo próximo
de zero no free tier e uma só tabela para provisionar e permissionar.

**Negativas.** Todo padrão de acesso novo exige repensar chaves ou criar índice.
Contagem total de produtos deixa de ser barata, o que motiva o ADR 0004. A
partição `PRODUCT#ACTIVE` concentra escrita e vira ponto quente se o catálogo
crescer muito.

**Mitigação futura.** Sufixar a partição de produtos (`PRODUCT#ACTIVE#<0-9>`) e
consultar em paralelo, quando o volume justificar.
