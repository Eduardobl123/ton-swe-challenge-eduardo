/**
 * Cópias defensivas de `Date`.
 *
 * `Date` é mutável em JavaScript, então devolver a referência interna de uma
 * entidade permite que qualquer chamador altere seu estado sem passar por
 * nenhum método. No caso do bloqueio de conta isso é concreto: recuar o
 * `lockedUntil` destrava um usuário que deveria estar bloqueado.
 *
 * Copiar na entrada e na saída fecha os dois lados. O custo é uma alocação por
 * acesso, irrelevante diante de qualquer chamada de rede do fluxo.
 */
export function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

export function cloneOptionalDate(date: Date | undefined): Date | undefined {
  return date === undefined ? undefined : new Date(date.getTime());
}
