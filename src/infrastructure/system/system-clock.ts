import type { Clock } from '../../domain/ports';

/**
 * Relógio real do processo.
 *
 * É o único ponto do código autorizado a chamar `new Date()` sem parâmetro.
 * Todo o resto recebe a porta `Clock`, o que torna o tempo uma entrada
 * controlável e permite testar expiração de bloqueio sem esperar.
 */
export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
