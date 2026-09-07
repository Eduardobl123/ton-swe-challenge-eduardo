# ADR 0005 — Rate limit em duas camadas, janela deslizante, fail-open

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#6](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/6)

## Contexto

O enunciado pede "algum mecanismo de rate-limit para lidar com um volume
significativo de requisições". A aplicação roda em Lambda (ADR 0008): não há
estado entre invocações e várias instâncias atendem em paralelo, o que descarta
qualquer contador em memória do processo.

Há também dois alvos distintos a proteger. O login precisa de limite por origem,
porque ainda não há usuário identificado e é onde acontece força bruta. A
listagem precisa de limite por usuário autenticado, porque limitar por endereço
puniria todos os clientes atrás de um mesmo NAT.

## Decisão

Duas camadas complementares.

**Na borda**, o throttle nativo do API Gateway com limites de taxa e rajada por
estágio. É barato, não consome invocação de Lambda e absorve tempestade de
tráfego antes que ela chegue à aplicação.

**Na aplicação**, um contador de janela deslizante atrás da porta
`RateLimiterStore`, com chave `user:<id>` nas rotas autenticadas e `ip:<addr>`
no login e na renovação de sessão. O nome da política entra na chave, para que
login e renovação vindos do mesmo endereço não dividam a mesma cota.

O algoritmo fica na camada de aplicação, não no adaptador. O armazenamento
apenas conta e devolve os totais das duas janelas relevantes; quem decide se a
requisição passa é a política. Assim existe uma implementação só do cálculo,
testável com relógio controlado, em vez de uma cópia em cada adaptador com
risco de divergirem.

O custo por requisição é uma escrita atômica na janela em curso mais uma
leitura da janela anterior. A intenção original era uma única escrita, mas
janela deslizante exige conhecer a contagem anterior — sem ela o que se tem é
janela fixa, com o defeito descrito abaixo. No DynamoDB isso é `UpdateItem` com
`ADD` e `ReturnValues`, mais um `GetItem` no item da janela anterior, ambos com
TTL para expurgo.

A resposta traz os cabeçalhos `RateLimit-Limit`, `RateLimit-Remaining` e
`RateLimit-Reset`, além de `Retry-After` no 429.

O `Retry-After` **não** é a borda da janela. Como a janela anterior entra
ponderada na seguinte, quem excedeu muito continua acima do limite depois da
virada: mandar tentar ali faz o cliente ser recusado de novo e, pior, essa
tentativa realimenta o contador. Um cliente que obedecesse o cabeçalho e
repetisse no ritmo do próprio limite se manteria preso sozinho, indefinidamente.

O valor devolvido é o instante em que a estimativa de fato cai abaixo do limite,
resolvendo a ponderação para o tempo decorrido. Com limite de 60 por minuto, seis
centenas de requisições produzem um `Retry-After` de 115 segundos, e não de 60.

Se o armazenamento do contador falhar, a requisição **passa** (`fail-open`),
registrando o evento. O comportamento é configurável.

## Alternativas consideradas

**Apenas o throttle do API Gateway.** Simples e sem custo de código. Descartado
porque o limite é global por estágio: um único cliente abusivo consumiria a cota
de todos, e não há como diferenciar cota de login de cota de listagem.

**Janela fixa.** Um contador por minuto cheio, e uma escrita por requisição sem
leitura nenhuma. Descartada pelo efeito de borda: quem envia a cota inteira nos
últimos instantes de um minuto e a cota inteira nos primeiros do seguinte passa
com o dobro em poucos segundos, concentrando a rajada exatamente onde ela mais
dói. A leitura extra por requisição é o preço de fechar isso.

**Token bucket com registro de timestamps.** Mais preciso. Descartado porque
exigiria guardar e podar uma lista por chave, transformando uma escrita atômica
em leitura, modificação e escrita — mais caro e sujeito a corrida.

**ElastiCache com Redis.** É a escolha certa em produção de alto volume.
Descartado aqui porque exige VPC, subnets e um custo fixo por hora que não se
justifica num desafio, além de acoplar a Lambda à rede privada e piorar o cold
start.

**Falhar fechado (`fail-closed`).** Descartado como padrão: uma instabilidade no
DynamoDB derrubaria a API inteira com 429, transformando um problema de
dependência em indisponibilidade total. Proteção contra abuso não vale
indisponibilidade para quem está usando corretamente — e a camada de borda
continua ativa nesse cenário.

## Consequências

**Positivas.** Cotas independentes por rota e por identidade. Contador atômico
sem corrida. Uma falha do contador degrada a proteção, não o serviço.

**Negativas.** Uma escrita e uma leitura no DynamoDB por requisição têm custo
real e somam alguns milissegundos de latência.

A janela deslizante é uma aproximação: ela supõe o tráfego da janela anterior
distribuído por igual, o que superestima quando a rajada foi no começo daquela
janela e subestima quando foi no fim. O erro é pequeno e o benefício é grande —
dois números por chave em vez de uma lista de instantes que cresce com o
tráfego e precisa ser podada.

**Requisições recusadas contam.** Quem insiste enquanto bloqueado alimenta o
próprio contador e demora mais a voltar. É deliberado: o cabeçalho diz quando
tentar, e ignorá-lo não deveria sair de graça. A alternativa, não contabilizar a
recusa, exigiria decidir antes de incrementar — ou seja, ler e depois escrever,
abrindo mão da atomicidade que sustenta a contagem sob concorrência.

Limitar o contador em um teto foi cogitado e descartado por piorar o quadro: com
a contagem saturada no próprio limite, a estimativa fica em `limite × peso +
limite`, que só desce ao limite quando o peso zera. O cliente ficaria preso por
mais tempo, não menos.

**Gatilho para revisar.** Se o volume tornar o custo por requisição relevante,
migrar a porta `RateLimiterStore` para Redis. A interface não muda.
