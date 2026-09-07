import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';

/**
 * Confere cada resposta contra o `docs/openapi.json` versionado.
 *
 * O documento é entregável avaliado, e documentação que descreve outra API é
 * pior do que nenhuma: quem integra confia nela. O teste de contrato do CI já
 * garante que o arquivo bate com as **rotas** declaradas no código; o que falta
 * é o outro lado, que só aparece em execução — o corpo que realmente sai, o
 * código de status que realmente acontece.
 *
 * A verificação é deliberadamente rígida em três pontos, e cada um deles já
 * seria um defeito de documentação:
 *
 * - rota ausente do documento: existe rota não documentada;
 * - status ausente da rota: a API responde algo que ninguém declarou;
 * - propriedade a mais no corpo: o esquema declara `additionalProperties: false`,
 *   então campo extra é vazamento de detalhe interno para fora do contrato.
 */
const SPEC_PATH = 'docs/openapi.json';

interface OpenApiDocument {
  readonly paths: Record<string, Record<string, OpenApiOperation | undefined> | undefined>;
}

interface OpenApiOperation {
  readonly responses?: Record<string, OpenApiResponse | undefined>;
}

interface OpenApiResponse {
  readonly content?: Record<string, { readonly schema?: unknown } | undefined>;
}

export type HeaderValue = string | string[] | number | undefined;

export interface HttpResponseLike {
  readonly statusCode: number;
  readonly body: string;
  headers: Record<string, HeaderValue>;
}

const documento = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

/** Compilar uma vez por esquema mantém o custo fora do laço de 61 requisições. */
const compilados = new Map<string, ValidateFunction>();

function validadorPara(chave: string, schema: unknown): ValidateFunction {
  const existente = compilados.get(chave);

  if (existente !== undefined) {
    return existente;
  }

  const validador = ajv.compile(schema as object);
  compilados.set(chave, validador);

  return validador;
}

/**
 * Falha o teste quando a resposta diverge do contrato publicado.
 *
 * Recebe o caminho do documento (`/v1/products`), e não a URL chamada: a URL
 * carrega query string, que não faz parte da identidade da rota.
 */
export function assertMatchesContract(
  method: string,
  routePath: string,
  response: HttpResponseLike,
): void {
  const verbo = method.toLowerCase();
  const caminho = routePath.split('?')[0] ?? routePath;
  const rota = documento.paths[caminho];

  if (rota === undefined) {
    throw new Error(
      `A rota ${caminho} não existe em ${SPEC_PATH}. ` +
        'A API responde por um caminho que a documentação não declara.',
    );
  }

  const operacao = rota[verbo];

  if (operacao === undefined) {
    throw new Error(`O método ${method.toUpperCase()} ${caminho} não existe em ${SPEC_PATH}.`);
  }

  const status = String(response.statusCode);
  const declarada = operacao.responses?.[status];

  if (declarada === undefined) {
    throw new Error(
      `${method.toUpperCase()} ${caminho} respondeu ${status}, ` +
        `status não declarado em ${SPEC_PATH}. Declarados: ` +
        `${Object.keys(operacao.responses ?? {}).join(', ')}.`,
    );
  }

  const conteudo = declarada.content?.['application/json'];

  if (conteudo?.schema === undefined) {
    if (response.body !== '') {
      throw new Error(
        `${method.toUpperCase()} ${caminho} ${status} devolveu corpo, ` +
          'mas o contrato declara resposta sem corpo.',
      );
    }

    return;
  }

  const cabecalho = response.headers['content-type'];
  // O Node entrega cabeçalho repetido como lista; concatenar mantém a checagem
  // honesta sem depender de qual forma chegou.
  const tipo = Array.isArray(cabecalho) ? cabecalho.join(';') : String(cabecalho ?? '');

  if (!tipo.includes('application/json')) {
    throw new Error(
      `${method.toUpperCase()} ${caminho} ${status} declarou ` +
        `application/json no contrato e respondeu "${tipo}".`,
    );
  }

  const validar = validadorPara(`${verbo} ${caminho} ${status}`, conteudo.schema);
  const corpo: unknown = JSON.parse(response.body);

  if (!validar(corpo)) {
    const problemas = (validar.errors ?? [])
      .map(
        (erro) =>
          `  ${erro.instancePath === '' ? '(raiz)' : erro.instancePath} ${erro.message ?? ''}`,
      )
      .join('\n');

    throw new Error(
      `${method.toUpperCase()} ${caminho} ${status} não bate com ${SPEC_PATH}:\n${problemas}\n` +
        `Corpo recebido: ${response.body.slice(0, 400)}`,
    );
  }
}

/** As rotas do documento, para provar que a jornada passou por todas elas. */
export function documentedRoutes(): ReadonlySet<string> {
  const rotas = new Set<string>();

  for (const [caminho, operacoes] of Object.entries(documento.paths)) {
    for (const verbo of Object.keys(operacoes ?? {})) {
      rotas.add(`${verbo.toUpperCase()} ${caminho}`);
    }
  }

  return rotas;
}
