variable "table_name" {
  description = "Nome da tabela única."
  type        = string
}

variable "point_in_time_recovery" {
  description = "Recuperação para qualquer instante dos últimos 35 dias."
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Impede remoção acidental. Verdadeiro em produção."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Etiquetas aplicadas ao recurso."
  type        = map(string)
  default     = {}
}
