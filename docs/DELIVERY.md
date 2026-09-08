# Checklist de entrega

Executar no dia da entrega, na ordem. Cada item é verificável — nenhum depende
de julgamento.

## Bloqueadores

- [x] **Repositório público.** O enunciado exige. Esquecer é eliminatório.

  ```bash
  gh repo edit Eduardobl123/ton-swe-challenge-eduardo --visibility public
  gh repo view Eduardobl123/ton-swe-challenge-eduardo --json visibility
  ```

- [x] **Nenhum segredo no histórico.** Confirmar que `.env`, `*.tfstate` e
      chaves nunca foram commitados.

  ```bash
  git log --all --name-only --pretty=format: | sort -u | grep -E '^\.env$|\.tfstate|\.pem$|credentials' || echo "limpo"
  ```

- [x] **O PDF do enunciado não está no repositório.** É material marcado como
      confidencial pela Stone e o repositório será público. Já está no
      `.gitignore`; confirmar que não entrou antes disso.

  ```bash
  git log --all --name-only --pretty=format: | grep -i 'SWE_Challenge' || echo "limpo"
  ```

## Código

- [x] CI verde no ramo principal.
- [ ] `npm ci && npm run typecheck && npm run lint && npm test` passa em clone limpo.
- [x] `npm run test:coverage` atinge os limites configurados.
- [x] `docs/openapi.json` regenerado e idêntico ao que a aplicação produz.
- [x] `LICENSE` presente na raiz.

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

- [x] README com a tabela de status refletindo a realidade.
- [x] Credenciais do usuário de demonstração documentadas para o avaliador.
- [x] Diagramas conferidos contra o código, não apenas contra o plano.
- [ ] `AI_USAGE.md` revisado.
- [x] ADRs cobrindo toda decisão com alternativa defensável.

## Verificação final

- [ ] Clonar o repositório em um diretório novo e seguir o README do zero, sem
      usar conhecimento prévio. Se algum passo falhar, é bug de documentação.

---

## O que ainda não pôde ser marcado, e por quê

Os itens de **Infraestrutura** exigem uma conta AWS real: `terraform apply`, o
seed contra a tabela provisionada, as quatro chamadas na URL do API Gateway, o
cold start e o `terraform destroy`. Nenhum deles é verificável sem credencial.

Os dois itens restantes exigem um ambiente que a máquina de desenvolvimento atual
não oferece:

- **Clone limpo** (`npm ci && npm run typecheck && npm run lint && npm test`) e a
  **verificação final** seguindo o README do zero dependem de `docker compose`
  para o DynamoDB Local. Os comandos passam no repositório atual e no CI, que sobe
  o banco de verdade — o que falta é o percurso completo em máquina nova.
- **`AI_USAGE.md` revisado** é leitura humana, não comando.

O restante foi conferido: repositório público, histórico sem segredo nem PDF, CI
verde em `main`, contrato regenerado batendo com as rotas, cobertura dentro dos
limites e documentação alinhada ao código.
