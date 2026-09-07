import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * Variáveis que apontam para um parâmetro em vez de carregar o valor.
 *
 * A função recebe o **nome** do parâmetro, e não o segredo. Valor em variável de
 * ambiente aparece no console, em qualquer listagem da configuração da função e
 * no histórico de quem tiver permissão de leitura — sem precisar invocar nada.
 */
const SECRET_PARAMETERS = {
  JWT_SECRET_PARAMETER: 'JWT_SECRET',
  SENTRY_DSN_PARAMETER: 'SENTRY_DSN',
} as const;

export interface SecretResolverOptions {
  readonly region: string;
  readonly source?: NodeJS.ProcessEnv;
}

/**
 * Resolve os segredos apontados por parâmetro, uma vez.
 *
 * Chamada no carregamento do módulo do Lambda, fora do handler: a instância é
 * reaproveitada entre invocações, então a leitura acontece uma vez por instância
 * em vez de uma vez por requisição. Buscar a cada chamada colocaria a latência
 * do SSM dentro do p99 de **toda** resposta — foi o que a revisão do plano
 * identificou.
 *
 * Nada acontece quando as variáveis de apontamento estão ausentes, que é o caso
 * em desenvolvimento e nos testes: ali o valor vem direto do ambiente.
 */
export async function resolveSecrets(options: SecretResolverOptions): Promise<void> {
  const env = options.source ?? process.env;

  const pendentes: { nome: string; destino: string }[] = [];

  for (const [apontador, destino] of Object.entries(SECRET_PARAMETERS)) {
    const nome = env[apontador];

    // Apontador ausente ou vazio significa "não usa parâmetro": o Sentry, por
    // exemplo, é opcional.
    if (nome !== undefined && nome.length > 0) {
      pendentes.push({ nome, destino });
    }
  }

  if (pendentes.length === 0) {
    return;
  }

  const client = new SSMClient({ region: options.region, maxAttempts: 3 });

  // Uma chamada para todos, e não uma por segredo: cada ida ao SSM soma ao
  // tempo de partida a frio.
  const { Parameters, InvalidParameters } = await client.send(
    new GetParametersCommand({
      Names: pendentes.map((p) => p.nome),
      WithDecryption: true,
    }),
  );

  if (InvalidParameters !== undefined && InvalidParameters.length > 0) {
    // Falhar aqui derruba a instância no carregamento, o que aparece no deploy.
    // Seguir sem o segredo produziria um erro de autenticação inexplicável na
    // primeira requisição.
    throw new Error(`Parâmetros não encontrados no SSM: ${InvalidParameters.join(', ')}.`);
  }

  const porNome = new Map<string, string>();

  for (const parametro of Parameters ?? []) {
    if (parametro.Name !== undefined && parametro.Value !== undefined) {
      porNome.set(parametro.Name, parametro.Value);
    }
  }

  for (const { nome, destino } of pendentes) {
    const valor = porNome.get(nome);

    if (valor === undefined) {
      throw new Error(`O parâmetro ${nome} veio sem valor.`);
    }

    env[destino] = valor;
  }
}
