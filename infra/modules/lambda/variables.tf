variable "function_name" {
  description = "Nome da função."
  type        = string
}

variable "package_dir" {
  description = "Diretório com o artefato pronto, produzido por `npm run package:lambda`."
  type        = string
}

variable "runtime" {
  description = "Runtime do Lambda. Alinhado à versão LTS usada em desenvolvimento."
  type        = string
  default     = "nodejs24.x"
}

variable "memory_size" {
  description = "Memória em MiB. Também define a fatia de CPU."
  type        = number
  default     = 512
}

variable "timeout_seconds" {
  description = "Tempo limite. Menor que o do API Gateway, de 30 segundos."
  type        = number
  default     = 10
}

variable "log_retention_days" {
  description = "Retenção do grupo de log. Sem valor explícito, seria infinita."
  type        = number
  default     = 14
}

variable "environment_variables" {
  description = "Variáveis de ambiente da função. Segredo não entra aqui."
  type        = map(string)
}

variable "table_arn" {
  description = "Identificador da tabela DynamoDB."
  type        = string
}

variable "table_index_arns" {
  description = "Identificadores dos índices. Consulta em índice exige permissão própria."
  type        = list(string)
}

variable "parameter_arns" {
  description = "Identificadores dos parâmetros do SSM que a função pode ler."
  type        = list(string)
}

variable "ssm_kms_key_arn" {
  description = "Chave usada para decifrar os parâmetros."
  type        = string
}

variable "region" {
  description = "Região, usada na condição de uso da chave."
  type        = string
}

variable "tags" {
  description = "Etiquetas aplicadas aos recursos."
  type        = map(string)
  default     = {}
}
