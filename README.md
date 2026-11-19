# Liga da Saideira

Liga de rolês entre amigos até a virada: check-in com foto, feed com brindes, tabela estilo Brasileirão e desafios.

Site estático (HTML + JS) que usa o Firebase para login (e-mail ou celular + senha) e banco de dados (Firestore). As fotos ficam comprimidas no próprio Firestore, então tudo funciona no plano gratuito.

## Pontuação
Bar 5 · Festa 10 · Resenha 0 · Cerveja 1 · Copo de destilado 2 · Shot 3 · Beijo 3 · Toco 1 · Transa 8 · PT −5.
Desempate: pontos, saídas (V), beijos menos tocos (SG).

## Configuração
1. Crie um projeto no Firebase, ative **Authentication > E-mail/senha** e crie o **Firestore** (modo produção).
2. Cole o `firebaseConfig` do app Web em `config.js`.
3. No Firestore, aba **Regras**, cole o conteúdo de `firestore.rules` e troque `VIRADA2027` pelo código da sua liga. Publique.
4. Em **Authentication > Configurações > Domínios autorizados**, adicione o domínio onde o site fica (ex.: `seuusuario.github.io`).

## Como entrar
- Celular vira login automaticamente (ex.: `(11) 91234-5678`). Não há SMS; a senha é o que protege.
- Para criar conta é preciso o código da liga.
- Quem entra por celular e esquece a senha precisa que o dono do projeto redefina pelo console do Firebase.

Beba com responsabilidade. +18.
