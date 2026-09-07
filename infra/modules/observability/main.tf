# Alarmes.
#
# Cada um responde a uma pergunta que alguém faria de madrugada: a API está
# devolvendo erro, está lenta, ou está sendo barrada antes de chegar na função.
# Alarme que não corresponde a uma dessas perguntas vira ruído e ensina a
# ignorar o resto.

resource "aws_sns_topic" "alerts" {
  count = var.create_topic ? 1 : 0

  name = "${var.name_prefix}-alerts"
  tags = var.tags
}

locals {
  # Sem destino configurado, o alarme ainda existe e fica visível no console.
  # Criar assinatura de e-mail por Terraform exigiria confirmação manual, e um
  # recurso que nasce pendente para sempre é pior que nenhum.
  alarm_targets = var.create_topic ? [aws_sns_topic.alerts[0].arn] : []
}

resource "aws_cloudwatch_metric_alarm" "server_errors" {
  alarm_name  = "${var.name_prefix}-5xx"
  namespace   = "AWS/ApiGateway"
  metric_name = "5xx"
  dimensions  = { ApiId = var.api_id }

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.server_error_threshold
  comparison_operator = "GreaterThanThreshold"

  # Sem dado significa sem tráfego, e não sem problema. Disparar aí acordaria
  # alguém toda madrugada de baixo movimento.
  treat_missing_data = "notBreaching"

  alarm_description = "A API está devolvendo erro do lado do servidor."
  alarm_actions     = local.alarm_targets
  ok_actions        = local.alarm_targets

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "latency" {
  alarm_name  = "${var.name_prefix}-latencia"
  namespace   = "AWS/Lambda"
  metric_name = "Duration"
  dimensions  = { FunctionName = var.function_name }

  # Percentil, e não média: a média esconde a cauda, e é a cauda que o usuário
  # sente. Uma em cada cem requisições levando cinco segundos não move a média.
  extended_statistic  = "p99"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.latency_threshold_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_description = "A cauda de latência passou do aceitável."
  alarm_actions     = local.alarm_targets
  ok_actions        = local.alarm_targets

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "throttles" {
  alarm_name  = "${var.name_prefix}-throttles"
  namespace   = "AWS/Lambda"
  metric_name = "Throttles"
  dimensions  = { FunctionName = var.function_name }

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  # Diferente do limite da aplicação: aqui é a própria conta recusando invocar a
  # função, e nenhuma requisição chega a ser processada.
  alarm_description = "A conta está recusando invocações da função."
  alarm_actions     = local.alarm_targets
  ok_actions        = local.alarm_targets

  tags = var.tags
}
