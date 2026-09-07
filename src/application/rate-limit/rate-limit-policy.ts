export interface RateLimitRule {
  /**
   * Nome estável da política, usado no log e como parte da chave do contador.
   *
   * Entra na chave de propósito: sem ele, login e renovação de sessão vindos do
   * mesmo endereço dividiriam a mesma cota, e gastar o limite de um derrubaria o
   * outro.
   */
  readonly name: string;
  /** Requisições permitidas dentro da janela. */
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitPolicies {
  readonly login: RateLimitRule;
  readonly refresh: RateLimitRule;
  readonly productsList: RateLimitRule;
}

const ONE_MINUTE_MS = 60_000;

export interface RateLimitPolicyInput {
  readonly loginPerMinute: number;
  readonly refreshPerMinute: number;
  readonly productsPerMinute: number;
}

/**
 * Monta as políticas a partir dos limites configurados.
 *
 * Os três valores vêm do ambiente. A janela é fixa em um minuto porque é a
 * unidade em que os limites são pensados e comunicados; torná-la configurável
 * multiplicaria as combinações sem que ninguém precise delas.
 */
export function buildRateLimitPolicies({
  loginPerMinute,
  refreshPerMinute,
  productsPerMinute,
}: RateLimitPolicyInput): RateLimitPolicies {
  return {
    login: { name: 'auth.login', limit: loginPerMinute, windowMs: ONE_MINUTE_MS },
    refresh: { name: 'auth.refresh', limit: refreshPerMinute, windowMs: ONE_MINUTE_MS },
    productsList: { name: 'products.list', limit: productsPerMinute, windowMs: ONE_MINUTE_MS },
  };
}

/**
 * Identificação do sujeito da cota.
 *
 * Rota autenticada limita por usuário, e não por endereço: vários clientes atrás
 * de um mesmo NAT compartilhariam a cota, e um deles derrubaria todos os outros.
 * O login limita por endereço porque ainda não há usuário identificado — e é
 * justamente ali que a força bruta acontece.
 */
export const rateLimitSubject = {
  user: (userId: string): string => `user:${userId}`,
  ip: (ipAddress: string): string => `ip:${ipAddress}`,
} as const;
