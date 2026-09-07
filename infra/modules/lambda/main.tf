# A função e a permissão que ela recebe.
#
# A política é o ponto mais delicado deste módulo: ela decide o que um código
# comprometido consegue alcançar. Nenhuma declaração usa `*` em recurso ou em
# ação.

data "archive_file" "package" {
  type        = "zip"
  source_dir  = var.package_dir
  output_path = "${path.module}/.terraform-artifact/lambda.zip"
}

resource "aws_cloudwatch_log_group" "lambda" {
  name = "/aws/lambda/${var.function_name}"

  # Retenção explícita. Sem ela o grupo nasce com retenção infinita, e o custo
  # cresce para sempre sem ninguém decidir isso.
  retention_in_days = var.log_retention_days

  tags = var.tags
}

resource "aws_iam_role" "lambda" {
  name = "${var.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

data "aws_iam_policy_document" "lambda" {
  # Escrita de log restrita ao grupo desta função.
  statement {
    sid       = "EscreverLog"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }

  # Acesso à tabela e aos índices. `DescribeTable` é exigido pela sonda de
  # prontidão: sem ela, `/ready` responderia 503 em produção e só lá — foi o que
  # a revisão do plano identificou como faltando.
  statement {
    sid    = "AcessarTabela"
    effect = "Allow"
    actions = [
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:TransactWriteItems",
      "dynamodb:DescribeTable",
    ]
    resources = concat([var.table_arn], var.table_index_arns)
  }

  # Leitura dos segredos, restrita aos parâmetros desta aplicação.
  statement {
    sid       = "LerSegredos"
    effect    = "Allow"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = var.parameter_arns
  }

  # Necessária para abrir os parâmetros cifrados. Restrita à chave gerenciada do
  # SSM, e não a qualquer chave da conta.
  statement {
    sid       = "DecifrarParametros"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [var.ssm_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${var.function_name}-policy"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_lambda_function" "main" {
  function_name = var.function_name
  role          = aws_iam_role.lambda.arn

  filename         = data.archive_file.package.output_path
  source_code_hash = data.archive_file.package.output_base64sha256

  handler = "index.handler"
  runtime = var.runtime

  # arm64 custa menos por milissegundo e tem desempenho equivalente para esta
  # carga. O binário do argon2 é resolvido para esta arquitetura no
  # empacotamento (ADR 0007).
  architectures = ["arm64"]

  # A memória também define a fatia de CPU. O argon2 consome 19 MiB por
  # verificação e é o que dita o piso; abaixo disto o login fica lento sem
  # economizar nada, porque a cobrança é por tempo vezes memória.
  memory_size = var.memory_size

  # Menor que o tempo limite do API Gateway, que é de 30 segundos: a função deve
  # desistir antes de quem espera por ela.
  timeout = var.timeout_seconds

  environment {
    variables = var.environment_variables
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  tags = var.tags
}
