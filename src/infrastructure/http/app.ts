import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../../main/container';
import { authPlugin } from './plugins/auth';
import { errorHandlerPlugin } from './plugins/error-handler';
import { rateLimitPlugin } from './plugins/rate-limit';
import { requestIdPlugin } from './plugins/request-id';
import { authRoutes } from './routes/auth.routes';
import { healthRoutes } from './routes/health.routes';
import { productRoutes } from './routes/products.routes';

/**
 * Teto do corpo aceito.
 *
 * As requisições desta API são credenciais e parâmetros de paginação: nenhuma
 * chega perto disso. Aceitar corpos grandes só daria a quem quisesse uma forma
 * barata de consumir memória do processo.
 */
const BODY_LIMIT_BYTES = 64 * 1024;

/**
 * Confia em um número exato de saltos, nunca na cadeia inteira.
 *
 * Com confiança irrestrita o Fastify adota o **primeiro** item de
 * `X-Forwarded-For`, que é escrito por quem faz a requisição. Bastaria variar o
 * cabeçalho a cada tentativa para anular a cota por origem — a defesa contra
 * força bruta no login. Contando saltos, o valor adotado é o que o proxy
 * imediatamente à frente escreveu, e esse não é escolhido pelo cliente.
 *
 * A função existe porque a tipagem do Fastify aceita apenas booleano, texto ou
 * predicado, embora o runtime também aceite um número. O predicado expressa a
 * mesma semântica sem precisar de asserção.
 */
function trustHops(hops: number): (address: string, hop: number) => boolean {
  return (_address, hop) => hop < hops;
}

/**
 * Monta a aplicação HTTP.
 *
 * A função **não sabe onde roda**. Ela devolve uma instância pronta, e quem
 * decide se isso vira um servidor escutando uma porta ou um handler de Lambda é
 * o entrypoint (issues #8 e #10). É o que permite testar toda a superfície com
 * `app.inject`, sem abrir porta de rede e sem esperar por socket.
 */
export async function buildApp(container: Container): Promise<FastifyInstance> {
  const { config } = container;

  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: trustHops(config.http.trustedProxyHops),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.http.corsOrigins.includes('*') ? true : [...config.http.corsOrigins],
  });

  await app.register(requestIdPlugin);
  await app.register(errorHandlerPlugin, { logger: container.logger });
  await app.register(authPlugin, { tokenSigner: container.services.tokenSigner });
  await app.register(rateLimitPlugin, { rateLimiter: container.services.rateLimiter });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Ton SWE Challenge — API',
        description:
          'Autenticação por JWT e catálogo paginado. Erros seguem a RFC 9457 e ' +
          'sempre trazem `code` e `requestId`.',
        version: config.version,
      },
      tags: [
        { name: 'Autenticação', description: 'Abertura, renovação e encerramento de sessão.' },
        { name: 'Catálogo', description: 'Listagem de produtos ativos.' },
        { name: 'Operação', description: 'Sondas de vida e de prontidão.' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  if (config.http.swaggerEnabled) {
    // Desligável por ambiente: em produção a documentação interativa entrega o
    // mapa da API a quem não precisa dele.
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  await app.register(healthRoutes(container));
  await app.register(authRoutes(container), { prefix: '/v1/auth' });
  await app.register(productRoutes(container), { prefix: '/v1' });

  return app;
}
