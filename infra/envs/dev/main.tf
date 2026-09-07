terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Estado remoto fica comentado de propósito.
  #
  # Quem avalia este projeto não tem o bucket, e um backend que não existe
  # impede até `terraform init`. Com o estado local, `init` e `apply` funcionam
  # em qualquer conta. Em uso compartilhado de verdade, descomente: sem estado
  # remoto e sem trava, duas pessoas aplicando ao mesmo tempo corrompem o
  # registro do que existe.
  #
  # backend "s3" {
  #   bucket       = "ton-challenge-tfstate"
  #   key          = "dev/terraform.tfstate"
  #   region       = "us-east-1"
  #   use_lockfile = true
  #   encrypt      = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Chave gerenciada do SSM. É com ela que os parâmetros cifrados são abertos, e a
# permissão de decifrar é restrita a ela.
data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

locals {
  prefix = "ton-challenge-${var.environment}"

  tags = {
    Project     = "ton-swe-challenge"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

module "database" {
  source = "../../modules/dynamodb"

  table_name = local.prefix
  # Em desenvolvimento a proteção fica desligada para que `terraform destroy`
  # funcione: o avaliador precisa conseguir limpar a conta dele.
  deletion_protection    = var.environment == "prod"
  point_in_time_recovery = true
  tags                   = local.tags
}

# Segredos.
#
# O valor não vem deste arquivo nem do estado em texto: `terraform apply` os
# recebe por variável de ambiente `TF_VAR_`, e o parâmetro é cifrado em repouso.
# Ainda assim o valor **fica no arquivo de estado**, o que é o motivo de o
# estado remoto precisar de cifra e de acesso restrito.
resource "aws_ssm_parameter" "jwt_secret" {
  name        = "/${local.prefix}/jwt-secret"
  description = "Segredo HMAC do access token e, com rótulo próprio, do cursor de paginação."
  type        = "SecureString"
  value       = var.jwt_secret
  tags        = local.tags
}

resource "aws_ssm_parameter" "sentry_dsn" {
  count = var.sentry_dsn == "" ? 0 : 1

  name        = "/${local.prefix}/sentry-dsn"
  description = "Destino dos relatos de erro. Ausente desliga o Sentry."
  type        = "SecureString"
  value       = var.sentry_dsn
  tags        = local.tags
}

module "api_function" {
  source = "../../modules/lambda"

  function_name = local.prefix
  # Produzido por `npm run package:lambda`, que resolve o binário nativo do
  # argon2 para linux/arm64 mesmo quando o build roda em outro sistema.
  package_dir = "${path.root}/../../../dist/lambda-package"

  memory_size     = var.memory_size
  timeout_seconds = 10

  environment_variables = {
    NODE_ENV     = "production"
    APP_VERSION  = var.app_version
    LOG_LEVEL    = var.log_level
    PERSISTENCE  = "dynamodb"
    TABLE_NAME   = module.database.table_name
    CORS_ORIGINS = join(",", var.cors_origins)

    # `AWS_REGION` não é declarada aqui: o Lambda a define sozinho e recusa
    # sobrescrita, e a aplicação já a lê do ambiente.

    # Um proxy à frente: o API Gateway. Confiar na cadeia inteira faria o
    # endereço vir do primeiro item do cabeçalho de encaminhamento, que quem faz
    # a requisição escolhe — e a cota por origem deixaria de existir.
    TRUSTED_PROXY_HOPS = "1"

    # Documentação interativa desligada: ela entrega o mapa da API a quem não
    # precisa dele.
    SWAGGER_ENABLED = "false"

    # Os segredos entram por referência ao parâmetro, e não por valor: o valor
    # em variável de ambiente aparece no console e em qualquer listagem da
    # configuração da função.
    JWT_SECRET_PARAMETER = aws_ssm_parameter.jwt_secret.name
    SENTRY_DSN_PARAMETER = var.sentry_dsn == "" ? "" : aws_ssm_parameter.sentry_dsn[0].name
  }

  table_arn        = module.database.table_arn
  table_index_arns = module.database.index_arns
  parameter_arns = concat(
    [aws_ssm_parameter.jwt_secret.arn],
    var.sentry_dsn == "" ? [] : [aws_ssm_parameter.sentry_dsn[0].arn],
  )
  ssm_kms_key_arn = data.aws_kms_alias.ssm.target_key_arn
  region          = data.aws_region.current.region

  tags = local.tags
}

module "api" {
  source = "../../modules/api_gateway"

  api_name             = local.prefix
  lambda_invoke_arn    = module.api_function.invoke_arn
  lambda_function_name = module.api_function.function_name
  cors_origins         = var.cors_origins
  throttle_burst       = var.throttle_burst
  throttle_rate        = var.throttle_rate

  tags = local.tags
}

module "alarms" {
  source = "../../modules/observability"

  name_prefix   = local.prefix
  api_id        = module.api.api_id
  function_name = module.api_function.function_name

  tags = local.tags
}
