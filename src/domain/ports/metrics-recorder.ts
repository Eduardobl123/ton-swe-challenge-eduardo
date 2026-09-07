export type MetricUnit = 'Count' | 'Milliseconds';

export type MetricDimensions = Readonly<Record<string, string>>;

/**
 * Registro de métricas operacionais.
 *
 * Separado do log de propósito. Log responde "o que aconteceu nesta
 * requisição"; métrica responde "quantas vezes e quão rápido", e é sobre ela
 * que alarme e painel se apoiam. Derivar contagem de busca em texto funciona
 * até o volume crescer, e aí custa caro justamente quando mais se precisa.
 */
export interface MetricsRecorder {
  record(name: string, value: number, unit: MetricUnit, dimensions?: MetricDimensions): void;
}
