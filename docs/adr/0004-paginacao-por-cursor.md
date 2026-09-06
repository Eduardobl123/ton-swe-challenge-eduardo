# ADR 0004 — Paginação por cursor, sem contagem total

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#5](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/5)

## Contexto

O desafio exige que a listagem seja paginada e preparada para "volume
significativo de requisições". O banco escolhido é o DynamoDB (ADR 0003), que
não oferece deslocamento numérico.

## Decisão

Paginação por cursor opaco. A resposta traz `nextCursor`, uma string base64url
que encapsula a `LastEvaluatedKey` do DynamoDB assinada com HMAC, para que um
cursor forjado seja rejeitado e o formato interno das chaves não vaze.

O `limit` tem padrão 20 e teto 100. Um pedido acima do teto é **ajustado**, não
recusado: pedir mil itens costuma ser otimismo, não ataque, e devolver cem
atende melhor que um erro. O ajuste é informado na resposta, e a borda HTTP o
traduz no cabeçalho `X-Limit-Clamped`, para que o cliente não conclua que
chegou ao fim da lista ao receber menos do que pediu.

A resposta **não** inclui contagem total.

## Alternativas consideradas

**Paginação por deslocamento (`page` e `offset`).** Familiar e fácil de
consumir. Inviável no DynamoDB, que não tem `OFFSET`: emular exigiria ler e
descartar todas as páginas anteriores, com custo crescente por página. Também é
instável sob escrita concorrente — um item inserido durante a navegação faz o
cliente ver um registro duas vezes ou pular outro.

**Cursor em claro (`LastEvaluatedKey` serializada sem assinatura).** Mais
simples. Descartado porque expõe o desenho das chaves da tabela e permite que o
cliente construa um cursor arbitrário.

**Incluir `totalCount`.** Confortável para montar paginador numérico na
interface. Descartado porque no DynamoDB exigiria um `Scan` completo ou um
contador mantido à parte, com custo e complexidade de consistência
desproporcionais. A resposta traz `hasMore`, que é o que a navegação realmente
precisa.

## Consequências

**Positivas.** Custo por página constante e independente da profundidade. Sem
duplicatas nem lacunas quando há escrita concorrente. O cursor é opaco, então a
implementação pode mudar sem quebrar o contrato.

**Negativas.** O cliente não consegue pular para a página 7 nem exibir "1 de
23". A navegação é sequencial.

**Aceitas conscientemente.** Para uma listagem de catálogo consumida por
aplicativo, rolagem infinita é o padrão de uso real, e é exatamente o que cursor
serve melhor.
