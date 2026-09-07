output "api_url" {
  description = "Endereço da API. Comece por GET /health."
  value       = module.api.api_url
}

output "table_name" {
  description = "Passe para a carga inicial: TABLE_NAME=$(terraform output -raw table_name)."
  value       = module.database.table_name
}

output "function_name" {
  value = module.api_function.function_name
}

output "package_size_bytes" {
  description = "Tamanho do artefato. Entra direto no tempo de partida a frio."
  value       = module.api_function.package_size_bytes
}

output "log_groups" {
  description = "Onde procurar pelo identificador de correlação."
  value = {
    application = module.api_function.log_group_name
    gateway     = module.api.log_group_name
  }
}

output "alarm_topic_arn" {
  description = "Assine à mão: a confirmação da inscrição não pode ser automatizada."
  value       = module.alarms.topic_arn
}
