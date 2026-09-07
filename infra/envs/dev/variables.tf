variable "environment" {
  description = "Nome do ambiente. Entra no nome dos recursos e nas etiquetas."
  type        = string
  default     = "dev"
}

variable "region" {
  description = "Região da AWS."
  type        = string
  default     = "us-east-1"
}

variable "jwt_secret" {
  description = "Segredo HMAC, com no mínimo 32 caracteres. Passe por TF_VAR_jwt_secret; nunca versione."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.jwt_secret) >= 32
    error_message = "O segredo precisa de ao menos 32 caracteres, que são os 256 bits que o HMAC-SHA256 usa."
  }
}

variable "sentry_dsn" {
  description = "Destino dos relatos de erro. Vazio desliga o Sentry."
  type        = string
  sensitive   = true
  default     = ""
}

variable "app_version" {
  description = "Versão da aplicação. No CI, o SHA do commit."
  type        = string
  default     = "local"
}

variable "log_level" {
  description = "Nível mínimo de log."
  type        = string
  default     = "info"
}

variable "memory_size" {
  description = "Memória da função, em MiB."
  type        = number
  default     = 512
}

variable "cors_origins" {
  description = "Origens permitidas. Restrinja em produção."
  type        = list(string)
  default     = ["*"]
}

variable "throttle_burst" {
  description = "Rajada aceita pelo API Gateway."
  type        = number
  default     = 100
}

variable "throttle_rate" {
  description = "Requisições por segundo sustentadas pelo API Gateway."
  type        = number
  default     = 50
}
