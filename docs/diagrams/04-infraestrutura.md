# Infraestrutura na AWS

Tudo provisionado por Terraform, sem passo manual além de `terraform apply` e da
carga inicial de dados. Ver [ADR 0008](../adr/0008-lambda-em-vez-de-fargate.md)
para a comparação com ECS Fargate.

O ponto de atenção operacional está nos segredos: eles são lidos do Parameter
Store **uma vez por instância**, no cold start, e reaproveitados entre
invocações. Ler a cada requisição colocaria a latência do SSM dentro do p99 de
toda chamada.

```mermaid
flowchart TB
    C["Cliente"]

    subgraph aws["Conta AWS"]
        AGW["API Gateway HTTP API<br/>estágio $default<br/>throttle de taxa e rajada<br/>logs de acesso em JSON"]

        subgraph fn["Lambda"]
            L["Node 24 · arm64 · 512 MB<br/>timeout 10 s<br/>bundle ESM único"]
        end

        DDB[("DynamoDB<br/>tabela única · sob demanda<br/>GSI1 · TTL · PITR")]
        SSM["SSM Parameter Store<br/>JWT_SECRET · SENTRY_DSN<br/>SecureString"]
        CW["CloudWatch<br/>logs 14 dias<br/>métricas embutidas<br/>alarmes de 5xx e latência"]
        IAM["IAM role<br/>menor privilégio<br/>apenas esta tabela"]
    end

    S["Sentry<br/>erros 5xx"]

    C --> AGW --> L
    L --> DDB
    L -. "cold start, cacheado" .-> SSM
    L --> CW
    L --> S
    IAM -. "concede" .- L

    style DDB fill:#e3fafc,stroke:#0b7285
    style SSM fill:#fff4e6,stroke:#e8590c
    style IAM fill:#f3f0ff,stroke:#5f3dc4
```

## Permissões concedidas à função

| Ação                                                 | Recurso                     | Por quê                             |
| ---------------------------------------------------- | --------------------------- | ----------------------------------- |
| `dynamodb:Query`, `GetItem`, `PutItem`, `UpdateItem` | apenas a tabela e o `GSI1`  | operações de leitura e escrita      |
| `dynamodb:BatchWriteItem`, `TransactWriteItems`      | apenas a tabela             | revogação de família de tokens      |
| `dynamodb:DescribeTable`                             | apenas a tabela             | verificação de prontidão (`/ready`) |
| `ssm:GetParameter`, `kms:Decrypt`                    | apenas os parâmetros da app | leitura dos segredos no cold start  |
| `logs:CreateLogStream`, `logs:PutLogEvents`          | apenas o grupo da função    | log estruturado                     |

Nenhuma declaração usa `*` em recurso ou em ação.
