# ADR 0009 — pino, Sentry e métricas embutidas no log

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#9](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/9)

## Contexto

O enunciado pede uma "API robusta". Robustez não é ausência de falha, é a
capacidade de saber o que falhou, para quem e em qual requisição. Em Lambda isso
é mais difícil que num processo longo: não há terminal para acompanhar, e cada
invocação é um evento isolado.

## Decisão

Três camadas complementares.

**Log estruturado** com `pino`, em JSON de uma linha, escrito no stdout e
coletado pelo CloudWatch Logs sem agente. Campos fixos de correlação em toda
linha: identificador da requisição, usuário, rota, situação e duração. Senha,
hash, cabeçalho de autorização e token são removidos por configuração de
redaction, não por disciplina de quem escreve o log.

**Correlação por `x-request-id`**, aceito do cliente ou gerado na entrada. O
mesmo identificador aparece no log, no corpo do erro devolvido ao cliente e no
evento do Sentry, o que permite ir da reclamação do usuário à causa sem
adivinhação.

**Rastreamento de erro com Sentry**, capturando apenas 5xx e exceções não
mapeadas. Erros esperados de negócio — credencial inválida, limite excedido,
token expirado — não geram evento. Sem DSN configurado, a aplicação sobe
normalmente, o que mantém desenvolvimento e CI limpos.

**Métricas** no formato de métricas embutidas do CloudWatch, emitidas pelo
próprio stdout: sucesso e falha de login, bloqueios, requisições limitadas e
duração por rota. Viram métrica sem nenhuma chamada de API.

## Alternativas consideradas

**Apenas `console.log`.** Zero dependência. Descartado porque texto livre não é
consultável: encontrar todas as requisições de um usuário vira busca por
substring, e não há como remover campo sensível de forma sistemática.

**OpenTelemetry com um coletor.** É o padrão aberto e evitaria acoplamento a
fornecedor. Descartado pelo peso da instrumentação no cold start e pela
necessidade de operar um coletor — desproporcional para o escopo. A porta de log
mantém a troca viável depois.

**AWS X-Ray.** Integra-se bem ao Lambda. Descartado como principal por ser
melhor em latência distribuída do que em agrupamento e alerta de exceção, que é
a necessidade real aqui. Pode somar-se depois sem conflito.

**Chamar a API de métricas do CloudWatch diretamente.** Descartado porque
adicionaria uma chamada de rede síncrona no caminho da requisição. O formato
embutido no log resolve pelo stdout, sem latência.

## Consequências

**Positivas.** Uma requisição é rastreável do log ao evento de erro pelo mesmo
identificador. Campos sensíveis não vazam mesmo com log em nível de depuração,
o que é garantido por teste. Métricas e alarmes sem custo de latência.

**Negativas.** Acoplamento ao Sentry como fornecedor, ainda que restrito a um
adaptador. O formato de métricas embutidas é específico da AWS. É preciso
descarregar os eventos do Sentry antes de a invocação terminar, sob pena de
perder o erro justamente quando ele acontece.

**Mitigação.** Usar o wrapper oficial do Sentry para ambientes sem servidor, que
cuida do descarregamento, e manter a taxa de amostragem de rastreamento baixa
para não pagar latência nem custo desnecessários.
