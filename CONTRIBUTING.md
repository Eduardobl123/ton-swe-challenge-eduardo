# Como contribuir

## Ambiente

```bash
nvm use     # Node 24.20.0, fixado no .nvmrc
npm ci      # instala e prepara o hook de pre-commit
```

## Fluxo de trabalho

O trabalho é rastreado por issues numeradas, cada uma com critérios de aceite
objetivos. Uma alteração começa por uma issue e termina em um pull request que a
referencia.

```bash
git switch -c feat/2-dominio-entidades-e-portas
```

O nome do ramo segue `<tipo>/<número da issue>-<resumo>`, com o tipo entre
`feat`, `fix`, `docs`, `refactor`, `test` e `chore`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), com escopo quando
ajudar, e o corpo explicando **por que** — o que mudou já está no diff.

```
feat(auth): bloqueia conta com resposta indistinguível de senha errada

Responder de forma diferente permitiria enumerar contas e bloquear
usuários de terceiros de propósito. Ver ADR 0010.

Closes #3
```

## Antes de abrir o pull request

O hook de pre-commit roda lint e formatação nos arquivos alterados. O conjunto
completo, que é o mesmo que o CI executa:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run openapi:export && git diff --exit-code docs/openapi.json

docker compose up -d --wait
npm run test:integration
```

O `main` deve exigir pull request com CI verde. A configuração fica em
Settings → Branches → Branch protection rules, marcando "Require status checks
to pass" com os sete trabalhos do fluxo de CI.

## O que a revisão vai cobrar

- **Direção da dependência.** O núcleo não importa infraestrutura nem pacote de
  terceiros. O lint falha, mas vale entender a regra antes de esbarrar nela:
  ver [`src/README.md`](src/README.md).
- **Teste junto com o código.** Regra de negócio nova sem teste unitário não
  entra. O gate de cobertura do núcleo é de 90%.
- **Decisão registrada.** Escolha de arquitetura com alternativa defensável
  merece um ADR em [`docs/adr/`](docs/adr/), com o que foi descartado e por quê.
- **Contrato atualizado.** Mudança em rota exige regenerar `docs/openapi.json`.
  O CI compara e falha se divergir.
- **Nada sensível em log.** Senha, hash, token e cabeçalho de autorização são
  removidos por configuração de redaction, não por cuidado de quem escreve.
