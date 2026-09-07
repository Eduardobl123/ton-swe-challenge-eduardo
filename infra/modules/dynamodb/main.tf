# Tabela única.
#
# Todas as entidades convivem aqui porque os padrões de acesso são poucos e
# conhecidos de antemão, e nenhum exige junção. Uma tabela por entidade
# multiplicaria este arquivo e as permissões sem trazer benefício (ADR 0003).

resource "aws_dynamodb_table" "main" {
  name = var.table_name

  # Cobrança sob demanda: o tráfego é intermitente, e capacidade provisionada
  # cobraria por hora ociosa. Também remove a necessidade de ajustar limites.
  billing_mode = "PAY_PER_REQUEST"

  # O provedor 6.63 avisa que estes atributos serão substituídos por um bloco
  # `key_schema`, que ainda não existe no esquema dele. Migrar agora é
  # impossível; o aviso fica registrado aqui para que ninguém o persiga.
  hash_key  = "pk"
  range_key = "sk"

  # Só os atributos que participam de chave são declarados. O DynamoDB não tem
  # esquema para o resto, e declará-los aqui daria a impressão errada.
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  # Expurgo de refresh token vencido e de contador de cota. É limpeza, não
  # autorização: a remoção acontece com atraso de até 48 horas, e quem decide
  # validade é o domínio.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Recuperação para qualquer instante dos últimos 35 dias. Um erro de operação
  # que apague dados é raro e caro; o custo disto é pequeno diante de não ter
  # para onde voltar.
  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  # Em produção, impede que um `terraform destroy` distraído leve a base junto.
  deletion_protection_enabled = var.deletion_protection

  tags = var.tags
}
