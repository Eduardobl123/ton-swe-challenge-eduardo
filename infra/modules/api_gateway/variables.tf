variable "api_name" {
  description = "Nome da API."
  type        = string
}

variable "lambda_invoke_arn" {
  description = "Identificador de invocação da função."
  type        = string
}

variable "lambda_function_name" {
  description = "Nome da função, usado na permissão de invocação."
  type        = string
}

variable "cors_origins" {
  description = "Origens permitidas. Restringir em produção."
  type        = list(string)
  default     = ["*"]
}

variable "throttle_burst" {
  description = "Rajada aceita antes de o limite morder."
  type        = number
  default     = 100
}

variable "throttle_rate" {
  description = "Requisições por segundo sustentadas."
  type        = number
  default     = 50
}

variable "integration_timeout_ms" {
  description = "Tempo limite da integração. Abaixo do da função."
  type        = number
  default     = 9000
}

variable "log_retention_days" {
  description = "Retenção do log de acesso."
  type        = number
  default     = 14
}

variable "tags" {
  description = "Etiquetas aplicadas aos recursos."
  type        = map(string)
  default     = {}
}
