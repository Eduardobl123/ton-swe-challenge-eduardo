# ADR 0006 — JWT curto com refresh rotativo e detecção de reuso

- **Status:** aceita
- **Data:** 2026-09-06
- **Issues:** [#3](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/3), [#4](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/4)

## Contexto

O enunciado exige autenticação por JWT protegendo as rotas. Um JWT é verificável
sem consultar o banco, o que é exatamente sua vantagem e sua limitação: não há
como revogá-lo antes de expirar.

Isso cria um dilema. Token longo é conveniente e perigoso, porque um vazamento
dá acesso por horas. Token curto é seguro e incômodo, porque obriga o usuário a
autenticar-se de novo o tempo todo.

## Decisão

Access token JWT de 15 minutos, assinado em HS256 com `jose`, validando as
claims `iss`, `aud`, `exp` e com o algoritmo fixado na verificação.

A renovação usa um **refresh token opaco** de 256 bits aleatórios, do qual só o
hash SHA-256 é persistido, com validade de 7 dias e TTL no DynamoDB.

A cada renovação o refresh é **rotacionado**: o antigo é marcado como
substituído e um novo par é emitido. Se um token já substituído for reapresentado
— sinal de que alguém está usando uma cópia roubada — toda a **família** de
tokens daquela sessão é revogada e o usuário precisa autenticar-se de novo.

O logout revoga a família do refresh apresentado.

## Alternativas consideradas

**Apenas access token, com validade longa.** Atende ao enunciado ao pé da letra
e é mais simples. Descartado porque transformaria qualquer vazamento de token em
acesso prolongado, sem meio de corte.

**Refresh token como JWT.** Dispensaria consulta ao banco na renovação.
Descartado porque um JWT não pode ser revogado, o que elimina justamente a
detecção de reuso — a propriedade mais valiosa deste desenho.

**Guardar o refresh token em claro.** Descartado: um vazamento do banco daria
sessões válidas de imediato. Guardar apenas o hash torna o vazamento inútil, e a
busca continua sendo por chave.

**RS256 ou ES256 com JWKS.** Permitiria que verificadores validassem sem poder
assinar. Descartado por ora pelo custo de gerir rotação de chaves e publicar o
JWKS num desafio. A porta `TokenSigner` isola a decisão: a troca não toca em
caso de uso.

**Lista de revogação por `jti` consultada a cada requisição.** Permitiria
invalidar o access token no logout. Descartada porque adicionaria uma leitura no
DynamoDB em **toda** requisição autenticada, anulando a principal vantagem do
JWT em troca de fechar uma janela de 15 minutos.

## Consequências

**Positivas.** A janela de exposição de um token vazado é de 15 minutos. O roubo
de um refresh token é detectado no primeiro uso concorrente e derruba a sessão
inteira. A verificação do access token continua sem tocar no banco.

**Negativas e limites conhecidos.** O access token emitido **permanece válido
até expirar mesmo após o logout** — em até 15 minutos ele deixa de funcionar,
mas não é cortado no ato. Este é o preço consciente de manter a verificação sem
estado.

O segredo HMAC precisa ser compartilhado com qualquer serviço que verifique o
token, o que é aceitável enquanto houver um único verificador.

**Gatilho para revisar.** Um requisito de revogação imediata, ou o surgimento de
um segundo serviço verificador, motiva migrar para chave assimétrica com JWKS e,
se necessário, uma lista de revogação por `jti` com TTL curto.
