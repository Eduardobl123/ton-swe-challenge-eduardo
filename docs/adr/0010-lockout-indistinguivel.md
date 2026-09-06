# ADR 0010 — Bloqueio de conta indistinguível de credencial inválida

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#3](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/3)

## Contexto

Bloquear a conta após algumas tentativas erradas é a defesa clássica contra
força bruta. A implementação ingênua, porém, cria dois problemas piores que o
que resolve.

O primeiro é **enumeração de contas**. Se a resposta ao bloqueio for diferente
da resposta a uma senha errada, basta enviar cinco tentativas para descobrir se
um endereço de e-mail existe. Confirmar quais e-mails têm conta em uma
instituição financeira é informação valiosa por si só.

O segundo é **negação de serviço contra o usuário**. Se qualquer pessoa consegue
bloquear qualquer conta enviando cinco senhas erradas, o mecanismo de proteção
vira ferramenta de ataque.

## Decisão

O bloqueio existe internamente, mas **nunca é visível na resposta**.

Usuário inexistente, senha errada e conta bloqueada produzem exatamente a mesma
resposta: `401` com o código `INVALID_CREDENTIALS`, o mesmo corpo e o mesmo
tempo. Enquanto bloqueada, a senha não é verificada, mas a duração da resposta é
equalizada com uma verificação contra um hash inerte (ADR 0007).

O bloqueio cresce exponencialmente a partir de 30 segundos, com **teto de 15
minutos**. O evento é registrado em log e métrica, onde a informação é útil sem
ser explorável.

O limite por origem no login (ADR 0005) permanece como defesa principal contra
força bruta distribuída, já que ele age antes de identificar a conta.

## Alternativas consideradas

**Responder `423 Locked` com o tempo restante.** É a opção mais amigável e a
mais comum. Descartada porque entrega os dois vetores descritos acima de uma vez
só: confirma a existência da conta e informa ao atacante exatamente quando
tentar de novo.

**Não bloquear, confiando apenas no limite por origem.** Mais simples e imune a
negação de serviço por conta. Descartada porque não protege contra ataque
distribuído por muitos endereços contra uma única conta de alto valor.

**Bloqueio permanente até intervenção manual.** Descartado por transformar
qualquer ataque trivial em chamado de suporte, e por não existir canal de
desbloqueio no escopo do desafio.

**CAPTCHA após algumas tentativas.** É a solução madura do mundo real.
Descartada por exigir serviço externo e interface, ambos fora do escopo de uma
API headless.

## Consequências

**Positivas.** A resposta do login não revela se um e-mail está cadastrado. Um
atacante não consegue bloquear a conta de terceiros de forma útil, porque o teto
de 15 minutos limita o dano e ele não recebe confirmação alguma. A força bruta
continua contida pelo limite por origem.

**Negativas.** Um usuário legítimo que errou a senha várias vezes recebe
"credenciais inválidas" mesmo digitando a senha certa, sem entender por quê. É
uma experiência ruim, deliberadamente escolhida.

**Mitigação.** O teto de 15 minutos mantém a janela curta. Os eventos ficam no
log e na métrica, de modo que o suporte consegue explicar o que houve. Num
produto real, o passo seguinte seria notificar o titular por e-mail — o canal
que já prova posse da conta, e portanto não vaza nada a quem não a possui.
