variable "name_prefix" {
  description = "Prefixo dos alarmes."
  type        = string
}

variable "api_id" {
  description = "Identificador da API, usado como dimensão."
  type        = string
}

variable "function_name" {
  description = "Nome da função, usado como dimensão."
  type        = string
}

variable "create_topic" {
  description = "Cria o tópico de notificação. A assinatura é feita à mão, porque exige confirmação."
  type        = bool
  default     = true
}

variable "server_error_threshold" {
  description = "Quantidade de erros de servidor em cinco minutos que dispara o alarme."
  type        = number
  default     = 1
}

variable "latency_threshold_ms" {
  description = "Latência de p99 aceitável, em milissegundos."
  type        = number
  default     = 3000
}

variable "tags" {
  description = "Etiquetas aplicadas aos recursos."
  type        = map(string)
  default     = {}
}
