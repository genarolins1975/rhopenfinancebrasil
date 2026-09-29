-- Preparação do banco da demonstração no Neon (DEC-45). Rode no SQL Editor do Neon, conectado ao banco padrão
-- (neondb), com o papel dono do projeto. Blocos um de cada vez, na ordem.
-- O SQL Editor do Neon pode rodar cada comando de um bloco numa conexão própria: nada aqui depende de estado de
-- sessão (tabela temporária, variável), e o Bloco 1 pode ser rodado de novo sem estrago.

-- Bloco 1: papéis. O resultado final mostra as duas senhas geradas pelo próprio banco: copie-as para um cofre de
-- senhas; não devem ir para email, chat, print nem planilha. As senhas ficam na tabela _senhas_demo do banco neondb até
-- o Bloco 4; rodar o Bloco 1 de novo mostra as mesmas senhas e mantém os papéis coerentes com elas.
CREATE TABLE IF NOT EXISTS _senhas_demo AS SELECT
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') AS senha_rh_owner,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') AS senha_rh_app;
DO $$
DECLARE s record;
BEGIN
  SELECT * INTO STRICT s FROM _senhas_demo;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rh_owner') THEN
    EXECUTE format('ALTER ROLE rh_owner LOGIN PASSWORD %L', s.senha_rh_owner);
  ELSE
    EXECUTE format('CREATE ROLE rh_owner LOGIN PASSWORD %L', s.senha_rh_owner);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rh_app') THEN
    EXECUTE format('ALTER ROLE rh_app LOGIN PASSWORD %L', s.senha_rh_app);
  ELSE
    EXECUTE format('CREATE ROLE rh_app LOGIN PASSWORD %L', s.senha_rh_app);
  END IF;
  EXECUTE format('GRANT rh_owner TO %I', current_user);
END $$;
ALTER ROLE rh_owner SET timezone = 'America/Sao_Paulo';
ALTER ROLE rh_app SET timezone = 'America/Sao_Paulo';
SELECT senha_rh_owner, senha_rh_app FROM _senhas_demo;

-- Bloco 2: banco. Rode sozinho (CREATE DATABASE não roda junto com outros comandos).
CREATE DATABASE rh_demo OWNER rh_owner;

-- Bloco 3: fuso do banco. Rode sozinho.
ALTER DATABASE rh_demo SET timezone = 'America/Sao_Paulo';

-- Bloco 4: limpeza. Rode no banco neondb, depois de guardar as senhas no cofre e montar as duas URLs. Depois dele, as senhas não
-- aparecem de novo.
DROP TABLE _senhas_demo;

-- Para recomeçar a demonstração do zero (apaga tudo do banco rh_demo): rode o comando abaixo, sozinho, e depois os
-- Blocos 2 e 3; em seguida, siga a seção "Recomeçar do zero" de demo-vercel.md.
-- DROP DATABASE rh_demo WITH (FORCE);
