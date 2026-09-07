import { describe, expect, it, vi } from 'vitest';
import {
  EmfMetricsRecorder,
  NoopMetricsRecorder,
} from '../../../../src/infrastructure/observability';
import { FixedClock } from '../../../support/fakes';

const AGORA = new Date('2026-09-07T12:00:00.000Z');

type Emf = Readonly<Record<string, unknown>> & {
  readonly _aws: {
    readonly Timestamp: number;
    readonly CloudWatchMetrics: {
      readonly Namespace: string;
      readonly Dimensions: string[][];
      readonly Metrics: { Name: string; Unit: string }[];
    }[];
  };
};

const campo = (emf: Emf | undefined, nome: string): unknown => emf?.[nome];

const capturar = (): { recorder: EmfMetricsRecorder; linhas: () => Emf[] } => {
  const buffer: string[] = [];

  return {
    recorder: new EmfMetricsRecorder(new FixedClock(AGORA), 'production', (l) => buffer.push(l)),
    linhas: () => buffer.map((l) => JSON.parse(l) as Emf),
  };
};

describe('EmfMetricsRecorder', () => {
  it('emite o bloco que o CloudWatch reconhece', () => {
    const { recorder, linhas } = capturar();

    recorder.record('LoginSuccess', 1, 'Count');

    const [emf] = linhas();
    expect(emf?._aws.CloudWatchMetrics[0]).toMatchObject({
      Namespace: 'TonSweChallenge',
      Metrics: [{ Name: 'LoginSuccess', Unit: 'Count' }],
    });
    expect(campo(emf, 'LoginSuccess')).toBe(1);
  });

  it('carimba o instante do relógio injetado', () => {
    const { recorder, linhas } = capturar();

    recorder.record('RequestDuration', 12.5, 'Milliseconds');

    expect(linhas()[0]?._aws.Timestamp).toBe(AGORA.getTime());
  });

  it('inclui o ambiente em toda métrica', () => {
    // Sem isso, produção e homologação somariam no mesmo gráfico.
    const { recorder, linhas } = capturar();

    recorder.record('LoginFailure', 1, 'Count');

    expect(campo(linhas()[0], 'Environment')).toBe('production');
    expect(linhas()[0]?._aws.CloudWatchMetrics[0]?.Dimensions[0]).toContain('Environment');
  });

  it('declara as dimensões informadas', () => {
    const { recorder, linhas } = capturar();

    recorder.record('RequestDuration', 8, 'Milliseconds', { Route: '/v1/products' });

    expect(campo(linhas()[0], 'Route')).toBe('/v1/products');
    expect(linhas()[0]?._aws.CloudWatchMetrics[0]?.Dimensions[0]).toEqual(['Environment', 'Route']);
  });

  it('emite uma linha de JSON por métrica', () => {
    const { recorder, linhas } = capturar();

    recorder.record('A', 1, 'Count');
    recorder.record('B', 2, 'Count');

    expect(linhas()).toHaveLength(2);
  });

  it('preserva valor fracionário de duração', () => {
    const { recorder, linhas } = capturar();

    recorder.record('RequestDuration', 12.75, 'Milliseconds');

    expect(campo(linhas()[0], 'RequestDuration')).toBe(12.75);
  });
});

describe('EmfMetricsRecorder sem destino informado', () => {
  it('escreve no stdout, que é de onde o CloudWatch lê', () => {
    // Publicar métrica passa a custar uma escrita que já acontece de qualquer
    // forma, em vez de uma chamada de rede no caminho da requisição.
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    new EmfMetricsRecorder(new FixedClock(AGORA), 'production').record('X', 1, 'Count');

    expect(stdout).toHaveBeenCalledOnce();
    expect(String(stdout.mock.calls[0]?.[0])).toContain('_aws');
    vi.restoreAllMocks();
  });
});

describe('NoopMetricsRecorder', () => {
  it('descarta sem falhar', () => {
    expect(() => new NoopMetricsRecorder().record()).not.toThrow();
  });
});
