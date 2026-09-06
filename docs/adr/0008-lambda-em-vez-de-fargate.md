# ADR 0008 — Lambda com API Gateway em vez de ECS Fargate

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#10](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/10)

## Contexto

O desafio avalia "compreensão e utilização de infraestrutura em nuvem" e
destaca Terraform como diferencial. A entrega precisa ser reproduzível por um
avaliador em uma conta AWS própria, sem custo relevante e sem passo manual.

O tráfego real é intermitente: alguns testes durante a avaliação, e nada entre
eles.

## Decisão

API Gateway HTTP API à frente de uma função Lambda em `arm64`, com 512 MB e
timeout de 10 segundos, empacotada como bundle ESM único.

A aplicação Fastify permanece agnóstica de onde roda: `buildApp()` não sabe da
existência do Lambda, e o handler apenas a envolve. O mesmo código serve o
servidor local.

Runtime alvo `nodejs24.x`, alinhado à versão LTS ativa do Node usada em
desenvolvimento. Como a entrega é um bundle, cair para `nodejs22.x` é a troca de
uma linha caso a conta de destino não ofereça o runtime mais novo — algo a
confirmar contra a lista de runtimes suportados no momento do deploy.

## Alternativas consideradas

**ECS Fargate com balanceador de aplicação.** Sem cold start e com processo
sempre ativo, o que simplifica cache em memória e conexões persistentes.
Descartado por duas razões: exigiria VPC, subnets, grupos de segurança,
balanceador, definição de tarefa e serviço — muito mais Terraform para revisar —
e cobra por hora mesmo ocioso, o que é difícil de justificar num repositório que
o avaliador vai subir e derrubar.

**EC2 com processo gerenciado.** Descartado de imediato: exige gestão de
sistema operacional, patching e escala manual, o oposto do que o enunciado
valoriza.

**App Runner.** Simples de provisionar. Descartado por menor controle sobre a
configuração e por não ter a integração natural com throttle por estágio que o
API Gateway oferece, usada como primeira camada de rate limit no ADR 0005.

## Consequências

**Positivas.** Custo praticamente zero em repouso e dentro do free tier em uso
de avaliação. Escala automática sem configuração. O throttle por estágio do API
Gateway entrega a camada de borda do rate limit sem código. `arm64` custa menos
e tem desempenho equivalente para esta carga.

**Negativas.** Cold start real, que o bundle único e a ausência de inicialização
pesada mitigam mas não eliminam. Estado em memória não é confiável entre
invocações, o que motivou o contador de rate limit externo (ADR 0005). O módulo
nativo do argon2 exige atenção ao empacotamento (ADR 0007).

**Mitigação.** Manter o bundle enxuto, ler segredos do SSM uma vez por instância
e não por requisição, e medir o cold start registrando o número no README.
