import { DomainError } from './app-error';

/**
 * A autenticação falhou.
 *
 * É deliberadamente vago. Usuário inexistente, senha errada e conta bloqueada
 * terminam todos aqui, com a mesma mensagem e o mesmo tempo de resposta. Uma
 * resposta específica para "esta conta existe, mas está bloqueada" permitiria
 * descobrir quais e-mails estão cadastrados e bloquear contas de terceiros de
 * propósito. O raciocínio completo está no ADR 0010.
 */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 'Credenciais inválidas.');
  }
}
