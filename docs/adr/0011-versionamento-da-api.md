# ADR 0011 — Versionamento da API por prefixo `/v1`

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#8](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/8)

## Contexto

Um contrato HTTP publicado passa a ter consumidores que não se atualizam junto
com o servidor. Sem um eixo de versão definido desde o início, a primeira mudança
incompatível — renomear um campo, mudar o formato do cursor, endurecer uma
validação — obriga a escolher entre quebrar clientes ou carregar remendo
permanente.

Introduzir versão depois é caro justamente quando ela passa a ser necessária.

## Decisão

Todas as rotas de negócio sob o prefixo `/v1`: `/v1/auth/login`,
`/v1/auth/refresh`, `/v1/auth/logout` e `/v1/products`.

As rotas operacionais `/health` e `/ready` ficam **fora** do prefixo. Elas
servem a orquestrador e a verificação de disponibilidade, não a consumidor da
API, e não devem mudar de endereço quando o contrato de negócio evoluir.

A versão é registrada como um plugin com prefixo, o que mantém os arquivos de
rota sem repetir o caminho.

## Alternativas consideradas

**Versionar por cabeçalho.** É a alternativa mais correta em termos de
arquitetura REST, já que preserva a identidade do recurso. Descartada por ser
difícil de exercitar em navegador e em `curl`, o que atrapalha justamente a
avaliação e a documentação interativa.

**Não versionar.** Menos ruído no caminho. Descartada porque o custo de
adicionar o prefixo agora é praticamente nulo, e o custo de adicioná-lo depois
recai sobre todos os consumidores existentes.

**Versionar por parâmetro de consulta.** Descartada por poluir o cache e tornar
ambíguo o comportamento quando o parâmetro é omitido.

## Consequências

**Positivas.** Uma segunda versão pode conviver com a primeira no mesmo serviço.
A documentação OpenAPI já nasce com o eixo de versão explícito. O contrato fica
óbvio para quem lê um log de acesso.

**Negativas.** Caminhos ligeiramente mais longos, e a versão passa a fazer parte
da identidade do recurso, o que é uma imprecisão em relação ao REST estrito.

**Aceitas conscientemente.** É a convenção dominante em API pública, e clareza
para quem consome vale mais que pureza conceitual.
