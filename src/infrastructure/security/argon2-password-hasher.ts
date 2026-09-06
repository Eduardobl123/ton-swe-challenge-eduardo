import { hash, verify } from '@node-rs/argon2';
import type { Algorithm, Options } from '@node-rs/argon2';
import { PasswordHash } from '../../domain/value-objects';
import type { PasswordHasher } from '../../domain/ports';

/**
 * Parâmetros do argon2id, conforme a recomendação do OWASP.
 *
 * Ficam em uma constante só porque precisam valer igual para o hash real e para
 * o hash inerte: se divergissem, o tempo de verificação de um e-mail
 * inexistente seria diferente do de um e-mail existente, e a comparação dos dois
 * revelaria quais contas existem — exatamente o que o hash inerte serve para
 * evitar.
 *
 * Os valores são gravados dentro do próprio hash (`$argon2id$v=19$m=...`), o que
 * permite endurecê-los depois e re-hashear na autenticação seguinte, sem
 * migração de dados.
 *
 * O algoritmo é fixado como número em vez de vir do enum da biblioteca porque
 * ele é declarado como `const enum` ambiente, incompatível com
 * `verbatimModuleSyntax`. Deixar de informá-lo e aceitar o padrão do pacote
 * seria pior: parâmetro de segurança não deve depender de default de terceiro,
 * que muda sem aviso entre versões. Um teste confere que o hash produzido é de
 * fato argon2id.
 */
const ARGON2ID = 2 as Algorithm;

const PARAMETERS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Hash inerte usado para equalizar o tempo de resposta do login.
 *
 * É o argon2id de 32 bytes aleatórios gerados e descartados: não existe senha
 * conhecida que corresponda a ele. Verificar contra este valor quando o usuário
 * não existe faz a resposta custar o mesmo que uma verificação real, de modo que
 * a duração da requisição não denuncie se o e-mail está cadastrado.
 *
 * Deixá-lo como constante evita gastar uma derivação a cada partida do processo,
 * o que no Lambda entraria direto no cold start.
 */
export const INERT_PASSWORD_HASH = PasswordHash.create(
  '$argon2id$v=19$m=19456,t=2,p=1$B/x0AlFlQt29EEi/ACgfwA$eUU/LDf8tNk319E2Y68soBKqJVKP5CuEpfTv1uWcv/w',
);

export class Argon2PasswordHasher implements PasswordHasher {
  public async hash(plainPassword: string): Promise<PasswordHash> {
    return PasswordHash.create(await hash(plainPassword, PARAMETERS));
  }

  /**
   * Devolve `false` em vez de propagar quando o hash armazenado está corrompido
   * ou em formato desconhecido.
   *
   * Propagar transformaria um registro estragado em erro 500, que é uma resposta
   * diferente das demais e, portanto, mais um sinal sobre o estado da conta. Um
   * dado ilegível significa apenas que a credencial não pôde ser confirmada.
   */
  public async verify(plainPassword: string, passwordHash: PasswordHash): Promise<boolean> {
    try {
      return await verify(passwordHash.value, plainPassword, PARAMETERS);
    } catch {
      return false;
    }
  }
}
