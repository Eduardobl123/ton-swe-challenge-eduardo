import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import type { FastifyError, FastifyPluginCallback, FastifySchemaValidationError } from 'fastify';
import type { Logger } from '../../../domain/ports';
import { fromAppError, isAppError, problemDetails, statusFor } from '../problem-details';
import type { ProblemFieldError } from '../problem-details';

export interface ErrorHandlerOptions {
  readonly logger: Logger;
}

/**
 * Tratamento central de erro.
 *
 * Existe um lugar só que decide o que o cliente vê. Espalhar `try/catch` pelas
 * rotas funcionaria até alguém acrescentar uma rota e esquecer — e o
 * vazamento seria uma mensagem de exceção com caminho de arquivo e nome de
 * tabela dentro.
 *
 * A regra é simples: erro previsto vira a resposta que ele descreve; qualquer
 * outra coisa vira 500 genérico, com o detalhe indo apenas para o log.
 */
const plugin: FastifyPluginCallback<ErrorHandlerOptions> = (app, { logger }, done) => {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(
        problemDetails({ code: 'NOT_FOUND', instance: request.url, requestId: request.requestId }),
      );
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const instance = request.url;
    const { requestId } = request;
    // Guardado antes das restrições de tipo abaixo, que estreitam `error` e
    // tornariam o acesso aos campos do framework inválido para o compilador.
    const cause: FastifyError = error;

    // Falha de schema: o cliente precisa saber qual campo recusou, o que é
    // informação sobre a própria requisição dele e não sobre o servidor.
    if (hasZodFastifySchemaValidationErrors(error)) {
      void reply.status(400).send(
        problemDetails({
          code: 'VALIDATION_ERROR',
          instance,
          requestId,
          errors: error.validation.map(toFieldError),
        }),
      );
      return;
    }

    // Resposta que não bate com o schema declarado é defeito nosso, não do
    // cliente: vira 500 e precisa aparecer no alerta.
    if (isResponseSerializationError(error)) {
      logger.error('http.response_schema_mismatch', {
        requestId,
        route: instance,
        reason: error.message,
      });
      void reply.status(500).send(problemDetails({ code: 'INTERNAL_ERROR', instance, requestId }));
      return;
    }

    if (isAppError(error)) {
      const status = statusFor(error.code);

      logger.info('http.request_refused', {
        requestId,
        route: instance,
        code: error.code,
        status,
      });
      void reply.status(status).send(fromAppError(error, instance, requestId));
      return;
    }

    // Corpo grande demais e JSON malformado chegam como erro do próprio
    // Fastify, com status já definido. São problema do cliente.
    const framework = cause.statusCode;
    if (framework !== undefined && framework >= 400 && framework < 500) {
      void reply
        .status(framework)
        .send(problemDetails({ code: 'VALIDATION_ERROR', instance, requestId }));
      return;
    }

    // Daqui para baixo é falha imprevista. A mensagem fica no log; o cliente
    // recebe apenas o código e o identificador para relatar.
    logger.error('http.unhandled_error', {
      requestId,
      route: instance,
      reason: cause.message,
    });
    void reply.status(500).send(problemDetails({ code: 'INTERNAL_ERROR', instance, requestId }));
  });

  done();
};

/**
 * Converte uma falha de schema no formato que o cliente recebe.
 *
 * O caminho vem como ponteiro JSON (`/page/limit`) e sai em notação de ponto,
 * que é como o consumidor pensa no próprio corpo. Falha na raiz não tem campo:
 * vira `(corpo)`, porque devolver cadeia vazia obrigaria o cliente a tratar o
 * caso sem nenhuma pista do que fazer.
 */
export function toFieldError(issue: FastifySchemaValidationError): ProblemFieldError {
  return {
    field: issue.instancePath.replace(/^\//, '').replaceAll('/', '.') || '(corpo)',
    message: issue.message ?? 'valor inválido',
  };
}

export const errorHandlerPlugin = fp(plugin, { name: 'error-handler' });
