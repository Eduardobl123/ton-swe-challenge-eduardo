# API HTTP com integração direta na função.
#
# A versão HTTP custa cerca de um terço da REST e traz o que este projeto
# precisa. A REST oferece chave de API, plano de uso e transformação de
# requisição — nada disso é usado aqui, e pagar por isso seria escolher o
# produto pelo catálogo em vez de pela necessidade.

resource "aws_apigatewayv2_api" "main" {
  name          = var.api_name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.cors_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type", "x-request-id"]
    max_age       = 3600
  }

  tags = var.tags
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.lambda_invoke_arn
  payload_format_version = "2.0"

  # Abaixo do tempo limite da própria função, para que a resposta de erro venha
  # da aplicação e não do gateway.
  timeout_milliseconds = var.integration_timeout_ms
}

# Rota coringa: o roteamento é da aplicação, que já conhece as rotas e devolve
# 404 no mesmo formato de erro das demais respostas. Declarar cada rota aqui
# duplicaria o contrato em dois lugares que divergiriam.
resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.api_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  # Primeira camada do limite de requisições (ADR 0005). Ela age antes de
  # consumir invocação da função, e protege contra rajada que a cota por
  # usuário nem chegaria a ver.
  default_route_settings {
    throttling_burst_limit = var.throttle_burst
    throttling_rate_limit  = var.throttle_rate
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn

    # JSON, e não texto: é o que permite consultar por campo. O identificador de
    # correlação entra aqui também, o que liga o registro do gateway ao da
    # aplicação.
    format = jsonencode({
      requestId       = "$context.requestId"
      correlationId   = "$context.requestId"
      ip              = "$context.identity.sourceIp"
      requestTime     = "$context.requestTime"
      routeKey        = "$context.routeKey"
      status          = "$context.status"
      protocol        = "$context.protocol"
      responseLength  = "$context.responseLength"
      integrationTime = "$context.integrationLatency"
      totalTime       = "$context.responseLatency"
    })
  }

  tags = var.tags
}

# Autoriza o gateway a invocar a função. Sem isto a integração existe e toda
# chamada devolve erro de permissão.
resource "aws_lambda_permission" "api" {
  statement_id  = "AllowInvokeFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"

  # Restrito a esta API. Sem o sufixo, qualquer API da conta poderia invocar.
  source_arn = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
