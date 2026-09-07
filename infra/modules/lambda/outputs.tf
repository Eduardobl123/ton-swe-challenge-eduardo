output "function_name" {
  value = aws_lambda_function.main.function_name
}

output "invoke_arn" {
  description = "Usado pelo API Gateway para integrar com a função."
  value       = aws_lambda_function.main.invoke_arn
}

output "function_arn" {
  value = aws_lambda_function.main.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.lambda.name
}

output "package_size_bytes" {
  description = "Tamanho do artefato. Entra direto no tempo de partida a frio."
  value       = data.archive_file.package.output_size
}
