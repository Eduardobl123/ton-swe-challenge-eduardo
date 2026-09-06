/**
 * Fonte de tempo da aplicação.
 *
 * Nenhum código de domínio chama `new Date()` diretamente. O tempo é entrada,
 * não ambiente: com ele injetado, testar a expiração de um bloqueio de 15
 * minutos é passar uma data adiante, em vez de esperar quinze minutos ou
 * substituir o relógio global do processo.
 */
export interface Clock {
  now(): Date;
}
