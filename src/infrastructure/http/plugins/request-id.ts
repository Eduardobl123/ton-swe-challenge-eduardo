import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginCallback } from 'fastify';

const HEADER = 'x-request-id';

/**
 * Aceita ou gera o identificador de correlação.
 *
 * Aceitar o valor de entrada é o que permite seguir uma requisição através de
 * mais de um serviço. Devolvê-lo no cabeçalho é o que permite ao usuário
 * relatar um problema de forma que alguém consiga achar no log.
 *
 * O tamanho é limitado porque o valor vem de fora: sem teto, um cabeçalho
 * enorme entraria em toda linha de log da requisição.
 */
const MAX_LENGTH = 128;

const plugin: FastifyPluginCallback = (app, _options, done) => {
  app.addHook('onRequest', (request, reply, next) => {
    // O Fastify já junta ocorrências repetidas do cabeçalho, então aqui chega
    // um texto ou nada. A conversão explícita cobre a assinatura do tipo, que
    // admite arranjo, sem inventar um ramo que nunca executa.
    const received = request.headers[HEADER];
    const candidate = received === undefined ? '' : String(received);
    const requestId =
      candidate.length > 0 && candidate.length <= MAX_LENGTH ? candidate : randomUUID();

    request.requestId = requestId;
    void reply.header(HEADER, requestId);
    next();
  });

  done();
};

export const requestIdPlugin = fp(plugin, { name: 'request-id' });
