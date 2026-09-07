import type { RateLimitWindows, RateLimiterStore } from '../../../domain/ports';

interface Bucket {
  /** Início da janela em curso, em milissegundos desde a época. */
  windowStartedAt: number;
  current: number;
  previous: number;
}

/**
 * Contador de requisições em memória.
 *
 * Serve ao desenvolvimento local e aos testes. Reproduz as duas garantias que o
 * adaptador DynamoDB terá (issue #7): o incremento acontece sem leitura prévia
 * separada, e a janela anterior fica disponível sem guardar a lista de instantes
 * de cada requisição.
 *
 * Duas limitações deliberadas, aceitáveis porque isto é um duplo. O estado vive
 * no processo, então várias instâncias não compartilham cota — é justamente o
 * motivo de o contador precisar ser externo em produção (ADR 0005). E as chaves
 * não são expurgadas: no DynamoDB o TTL cuida disso, aqui um processo de longa
 * duração acumularia uma entrada por chave já vista.
 */
export class InMemoryRateLimiterStore implements RateLimiterStore {
  private readonly buckets = new Map<string, Bucket>();

  public hit(key: string, windowMs: number, now: Date): Promise<RateLimitWindows> {
    // Alinha ao tamanho da janela, e não ao instante da primeira requisição:
    // assim todas as instâncias concordam sobre onde uma janela começa.
    const windowStartedAt = Math.floor(now.getTime() / windowMs) * windowMs;
    const bucket = this.buckets.get(key);

    const updated = advance(bucket, windowStartedAt, windowMs);
    this.buckets.set(key, updated);

    return Promise.resolve({
      current: updated.current,
      previous: updated.previous,
      windowStartedAt: new Date(updated.windowStartedAt),
    });
  }
}

/**
 * Move o contador para a janela informada e registra a requisição.
 *
 * A janela anterior só é preservada quando ela é de fato a **imediatamente**
 * anterior. Depois de um intervalo sem tráfego, arrastar uma contagem antiga
 * penalizaria alguém por requisições que já saíram do intervalo observado.
 */
function advance(bucket: Bucket | undefined, windowStartedAt: number, windowMs: number): Bucket {
  if (bucket === undefined) {
    return { windowStartedAt, current: 1, previous: 0 };
  }

  if (bucket.windowStartedAt === windowStartedAt) {
    return { ...bucket, current: bucket.current + 1 };
  }

  if (bucket.windowStartedAt === windowStartedAt - windowMs) {
    return { windowStartedAt, current: 1, previous: bucket.current };
  }

  return { windowStartedAt, current: 1, previous: 0 };
}
