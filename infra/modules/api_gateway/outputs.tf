output "api_url" {
  description = "Endereço público da API."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "api_id" {
  value = aws_apigatewayv2_api.main.id
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.access.name
}
