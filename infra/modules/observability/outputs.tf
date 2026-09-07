output "topic_arn" {
  description = "Tópico de notificação, quando criado. Assine à mão: a confirmação não pode ser automatizada."
  value       = var.create_topic ? aws_sns_topic.alerts[0].arn : null
}

output "alarm_names" {
  value = [
    aws_cloudwatch_metric_alarm.server_errors.alarm_name,
    aws_cloudwatch_metric_alarm.latency.alarm_name,
    aws_cloudwatch_metric_alarm.throttles.alarm_name,
  ]
}
