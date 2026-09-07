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
que encapsula a posição na ordenação — no DynamoDB, a `LastEvaluatedKey`.

O conteúdo é **cifrado com AES-256-GCM**, e não apenas assinado. A distinção
importa porque são duas propriedades diferentes. Assinatura impede forja, mas
não esconde nada: base64 decodifica em uma linha, e o cursor carregaria as
chaves da tabela em toda resposta paginada. A cifra autenticada entrega
confidencialidade e integridade na mesma operação — um cursor adulterado falha
na verificação da etiqueta, e um cursor legítimo não revela o que carrega.

A chave é derivada do segredo do JWT com um rótulo próprio, em vez de vir de uma
variável dedicada. Ela precisa ser estável entre instâncias, senão um cursor
emitido por uma invocação do Lambda seria ilegível para a seguinte, e é um
parâmetro a menos para provisionar. A separação por rótulo garante que a chave
derivada não sirva para assinar token, nem o segredo do token para ler cursor.

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

**Cursor em claro (`LastEvaluatedKey` serializada sem proteção).** Mais simples.
Descartado porque expõe o desenho das chaves da tabela e permite que o cliente
construa um cursor arbitrário.

**Apenas HMAC.** Foi a primeira escolha, e estava incompleta: impede forja, mas
o conteúdo continua legível para quem decodifica o base64. Como o cursor passará
a carregar as chaves da tabela, esconder é tão necessário quanto autenticar.

**Incluir `totalCount`.** Confortável para montar paginador numérico na
interface. Descartado porque no DynamoDB exigiria um `Scan` completo ou um
contador mantido à parte, com custo e complexidade de consistência
desproporcionais. A resposta traz `hasMore`, que é o que a navegação realmente
precisa.

## Consequências

**Positivas.** Custo por página constante e independente da profundidade. Sem
duplicatas nem lacunas quando há escrita concorrente. O cursor é opaco de fato,
então a implementação pode mudar sem quebrar o contrato, e o desenho da tabela
não aparece na resposta.

**Negativas.** O cliente não consegue pular para a página 7 nem exibir "1 de
23". A navegação é sequencial.

Rotacionar o segredo invalida os cursores em circulação. É aceitável: eles são
efêmeros, e a rotação já invalida todos os tokens de acesso de qualquer forma.
Uma implantação que mude o formato interno do cursor também precisa recusá-lo,
o que é feito validando a forma do conteúdo depois de decifrar.

**Aceitas conscientemente.** Para uma listagem de catálogo consumida por
aplicativo, rolagem infinita é o padrão de uso real, e é exatamente o que cursor
serve melhor.
