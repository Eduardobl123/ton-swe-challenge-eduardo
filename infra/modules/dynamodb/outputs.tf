output "table_name" {
  description = "Nome da tabela, usado na configuração da aplicação."
  value       = aws_dynamodb_table.main.name
}

output "table_arn" {
  description = "Identificador da tabela, usado na política de acesso."
  value       = aws_dynamodb_table.main.arn
}

output "index_arns" {
  description = "Identificadores dos índices. A permissão de consulta precisa deles, e não apenas do da tabela."
  value       = ["${aws_dynamodb_table.main.arn}/index/*"]
}
