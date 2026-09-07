import type { Clock, Logger, RateLimiterStore } from '../../domain/ports';
import type { RateLimitRule } from './rate-limit-policy';

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Limite configurado. Vira o cabeçalho `RateLimit-Limit`. */
  readonly limit: number;
  /** Quanto ainda cabe na janela. Vira `RateLimit-Remaining`. */
  readonly remaining: number;
  /** Quando a cota se renova. Vira `RateLimit-Reset`. */
  readonly resetAt: Date;
  /** Segundos até valer a pena tentar de novo. Vira `Retry-After` no 429. */
  readonly retryAfterSeconds: number;
}

export interface RateLimiterDependencies {
  readonly store: RateLimiterStore;
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * O que fazer quando o contador não responde.
   *
   * Verdadeiro deixa a requisição passar, priorizando disponibilidade; falso
   * recusa, priorizando proteção. Ver ADR 0005.
   */
  readonly failOpen: boolean;
}

/**
 * Contagem de requisições por janela deslizante.
 *
 * ## Por que não janela fixa
 *
 * Contar por minuto cheio é mais simples e tem um defeito conhecido: quem envia
 * o limite inteiro nos últimos instantes de um minuto e o limite inteiro nos
 * primeiros do minuto seguinte passa com o dobro da cota em poucos segundos —
 * exatamente a rajada concentrada que o limite existe para conter.
 *
 * ## Como a janela desliza sem guardar timestamps
 *
 * A alternativa exata seria registrar o instante de cada requisição e contar as
 * que caem no último minuto. Custa uma lista por chave, que cresce com o
 * tráfego e precisa ser podada.
 *
 * Esta implementação aproxima: mantém apenas dois contadores, o da janela em
 * curso e o da anterior, e pondera o anterior pela fração dele que ainda
 * pertence ao intervalo observado. Aos 15 segundos de uma janela de 60, três
 * quartos do minuto observado ainda vêm da janela anterior, então ela entra com
 * peso 0,75.
 *
 * O erro da aproximação é pequeno e sempre conservador na direção certa: ela
 * supõe o tráfego anterior distribuído por igual, o que superestima quando a
 * rajada foi no começo daquela janela e subestima quando foi no fim. Em troca,
 * são dois números por chave em vez de uma lista, e o custo por requisição não
 * cresce com o tráfego.
 */
export class RateLimiter {
  constructor(private readonly deps: RateLimiterDependencies) {}

  public async check(rule: RateLimitRule, subject: string): Promise<RateLimitDecision> {
    const now = this.deps.clock.now();
    // O nome da política entra na chave para que cotas distintas não se somem.
    const key = `${rule.name}#${subject}`;

    let windows;
    try {
      windows = await this.deps.store.hit(key, rule.windowMs, now);
    } catch (error) {
      return this.onStoreFailure(rule, subject, error);
    }

    const elapsedMs = now.getTime() - windows.windowStartedAt.getTime();
    const previousWeight = Math.max(0, (rule.windowMs - elapsedMs) / rule.windowMs);
    const estimate = windows.previous * previousWeight + windows.current;

    const resetAt = new Date(windows.windowStartedAt.getTime() + rule.windowMs);
    const allowed = estimate <= rule.limit;

    if (!allowed) {
      this.deps.logger.warn('rate_limit.exceeded', {
        rule: rule.name,
        subject,
        limit: rule.limit,
        estimated: Math.round(estimate),
      });
    }

    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - Math.ceil(estimate)),
      resetAt,
      retryAfterSeconds: secondsUntil(resetAt, now),
    };
  }

  /**
   * Decide o que fazer quando o contador está indisponível.
   *
   * Falhar fechado transformaria uma instabilidade do banco em indisponibilidade
   * total da API: todo mundo receberia 429, inclusive quem está usando
   * corretamente. Proteção contra abuso não vale isso, ainda mais porque o
   * throttle do API Gateway continua ativo nesse cenário (ADR 0005).
   *
   * O evento é registrado como erro, e não como aviso: contador fora do ar
   * significa que a aplicação está sem uma de suas defesas, e isso precisa
   * disparar alerta.
   */
  private onStoreFailure(rule: RateLimitRule, subject: string, error: unknown): RateLimitDecision {
    const now = this.deps.clock.now();

    this.deps.logger.error('rate_limit.store_error', {
      rule: rule.name,
      subject,
      failOpen: this.deps.failOpen,
      reason: error instanceof Error ? error.message : 'desconhecido',
    });

    const resetAt = new Date(now.getTime() + rule.windowMs);

    return {
      allowed: this.deps.failOpen,
      limit: rule.limit,
      // Sem contador não há como saber o que resta. Zero é a resposta honesta, e
      // faz o cliente bem-comportado desacelerar sozinho.
      remaining: 0,
      resetAt,
      retryAfterSeconds: secondsUntil(resetAt, now),
    };
  }
}

/** Nunca devolve zero: `Retry-After: 0` convida a repetir imediatamente. */
function secondsUntil(instant: Date, now: Date): number {
  return Math.max(1, Math.ceil((instant.getTime() - now.getTime()) / 1000));
}
