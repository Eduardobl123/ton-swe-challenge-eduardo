# ADR 0007 — argon2id para hash de senha

- **Status:** aceita
- **Data:** 2026-09-06
- **Issue:** [#3](https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/3)

## Contexto

O enunciado pede login "de forma segura". A escolha do algoritmo de derivação da
senha é a decisão isolada com maior impacto no custo de um vazamento do banco.

## Decisão

`argon2id` com os parâmetros recomendados pelo OWASP: 19 MiB de memória, duas
iterações e paralelismo 1.

O algoritmo fica atrás da porta `PasswordHasher`, com o caso de uso conhecendo
apenas `hash` e `verify`. Os parâmetros ficam registrados no próprio hash, o que
permite endurecê-los depois e re-hashear na próxima autenticação bem-sucedida.

O tempo de resposta do login é equalizado: quando o e-mail não existe ou a conta
está bloqueada, a verificação roda contra um hash inerte pré-computado, para que
o tempo de resposta não revele o estado da conta (ver ADR 0010).

## Alternativas consideradas

**bcrypt.** Amplamente usado e disponível em toda parte. Descartado por dois
motivos: o custo é apenas de processamento, o que o torna vulnerável a ataque
com hardware dedicado, e ele trunca silenciosamente senhas acima de 72 bytes.

**scrypt (`node:crypto`).** Nativo, sem módulo compilado, e com custo de
memória. É a alternativa mais próxima e continua sendo o plano B caso o módulo
nativo cause problema no empacotamento para Lambda. Descartado como padrão
porque o argon2id é o vencedor da competição de hashing de senhas e a
recomendação atual do OWASP.

**PBKDF2.** Ainda aceito em contextos de conformidade. Descartado por ser o mais
fraco dos quatro contra hardware dedicado, ao custo do mesmo tempo de resposta.

## Consequências

**Positivas.** Custo de memória e de processamento tornam ataque em massa a um
vazamento caro. A resistência a canal lateral do argon2id é a mais forte entre
as opções disponíveis. Os parâmetros no hash permitem endurecer sem migração.

**Negativas.** É um módulo nativo, o que exige atenção ao empacotar para o
Lambda: um binário compilado para a plataforma errada quebra em runtime, e não
no build. Cada verificação consome 19 MiB de memória e alguns milissegundos, o
que dimensiona a função e torna o limite de tamanho da senha obrigatório.

**Mitigação.** Testar a invocação real cedo no ciclo da issue #10 e usar uma
distribuição com binário pré-compilado para `linux/arm64`. O plano B é o
`scrypt` nativo, trocando apenas o adaptador.
