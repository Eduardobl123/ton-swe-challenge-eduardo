# Checklist de entrega

Executar no dia da entrega, na ordem. Cada item é verificável — nenhum depende
de julgamento.

## Bloqueadores

- [ ] **Repositório público.** O enunciado exige. Esquecer é eliminatório.

  ```bash
  gh repo edit Eduardobl123/ton-swe-challenge-eduardo --visibility public
  gh repo view Eduardobl123/ton-swe-challenge-eduardo --json visibility
  ```

- [ ] **Nenhum segredo no histórico.** Confirmar que `.env`, `*.tfstate` e
      chaves nunca foram commitados.

  ```bash
  git log --all --name-only --pretty=format: | sort -u | grep -E '^\.env$|\.tfstate|\.pem$|credentials' || echo "limpo"
  ```

- [ ] **O PDF do enunciado não está no repositório.** É material marcado como
      confidencial pela Stone e o repositório será público. Já está no
      `.gitignore`; confirmar que não entrou antes disso.

  ```bash
  git log --all --name-only --pretty=format: | grep -i 'SWE_Challenge' || echo "limpo"
  ```

## Código

- [ ] CI verde no ramo principal.
- [ ] `npm ci && npm run typecheck && npm run lint && npm test` passa em clone limpo.
- [ ] `npm run test:coverage` atinge os limites configurados.
- [ ] `docs/openapi.json` regenerado e idêntico ao que a aplicação produz.
- [ ] `LICENSE` presente na raiz.

## Infraestrutura

- [ ] `terraform apply` executado em uma conta real.
- [ ] `npm run db:seed` executado contra a tabela provisionada.
- [ ] A URL do API Gateway responde:
  - [ ] `GET /health` com 200
  - [ ] `GET /ready` com 200, o que prova que o IAM tem `DescribeTable`
  - [ ] `POST /v1/auth/login` com o usuário de demonstração
  - [ ] `GET /v1/products` com o token obtido, retornando dados do seed
- [ ] Cold start medido e registrado no README.
- [ ] `terraform destroy` testado, para que o avaliador consiga limpar a conta.

## Documentação

- [ ] README com a tabela de status refletindo a realidade.
- [ ] Credenciais do usuário de demonstração documentadas para o avaliador.
- [ ] Diagramas conferidos contra o código, não apenas contra o plano.
- [ ] `AI_USAGE.md` revisado.
- [ ] ADRs cobrindo toda decisão com alternativa defensável.

## Verificação final

- [ ] Clonar o repositório em um diretório novo e seguir o README do zero, sem
      usar conhecimento prévio. Se algum passo falhar, é bug de documentação.
