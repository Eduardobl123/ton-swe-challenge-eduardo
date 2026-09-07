import type { Clock, MetricDimensions, MetricUnit, MetricsRecorder } from '../../domain/ports';

const NAMESPACE = 'TonSweChallenge';

/**
 * Métricas no formato embutido do CloudWatch.
 *
 * O formato é uma linha de JSON com um bloco `_aws` que o CloudWatch reconhece
 * ao ler o log: publicar uma métrica passa a custar uma escrita no stdout, que
 * já acontece de qualquer forma, em vez de uma chamada de rede no caminho da
 * requisição. Chamar a API a cada métrica somaria latência à resposta e criaria
 * mais uma dependência que pode estar fora do ar.
 *
 * A estrutura é montada aqui em vez de vir da biblioteca oficial. Ela detecta
 * ambiente, mantém estado global e descarrega de forma assíncrona — tudo o que
 * complica teste e encerramento no Lambda —, enquanto o formato em si é
 * documentado e estável, e cabe em uma função.
 */
export class EmfMetricsRecorder implements MetricsRecorder {
  constructor(
    private readonly clock: Clock,
    private readonly environment: string,
    private readonly write: (line: string) => void = (line) => {
      process.stdout.write(`${line}\n`);
    },
  ) {}

  public record(
    name: string,
    value: number,
    unit: MetricUnit,
    dimensions: MetricDimensions = {},
  ): void {
    // O ambiente entra em toda métrica para que produção e homologação não
    // somem no mesmo gráfico.
    const allDimensions = { Environment: this.environment, ...dimensions };

    this.write(
      JSON.stringify({
        _aws: {
          Timestamp: this.clock.now().getTime(),
          CloudWatchMetrics: [
            {
              Namespace: NAMESPACE,
              // Só as dimensões declaradas viram série temporal. Declarar
              // demais multiplica o custo: o CloudWatch cobra por combinação
              // única, e um campo de alta cardinalidade — identificador de
              // usuário, por exemplo — geraria uma série por pessoa.
              Dimensions: [Object.keys(allDimensions)],
              Metrics: [{ Name: name, Unit: unit }],
            },
          ],
        },
        ...allDimensions,
        [name]: value,
      }),
    );
  }
}

/** Descarta as métricas. Usado em teste e onde a coleta não se aplica. */
export class NoopMetricsRecorder implements MetricsRecorder {
  public record(): void {
    // Silêncio deliberado.
  }
}
