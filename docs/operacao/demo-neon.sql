-- Preparação do banco da demonstração no Neon (DEC-45). Rode no SQL Editor do Neon, conectado ao banco padrão
-- (neondb), com o papel dono do projeto. Três blocos, um de cada vez, na ordem.

-- Bloco 1: papéis. Rode sozinho. O resultado final mostra as duas senhas geradas pelo próprio banco: copie-as para um
-- cofre de senhas; elas não aparecem de novo e não devem ir para email, chat nem planilha.
CREATE TEMP TABLE _senhas AS SELECT
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') AS senha_rh_owner,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') AS senha_rh_app;
DO $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM _senhas;
  EXECUTE format('CREATE ROLE rh_owner LOGIN PASSWORD %L', s.senha_rh_owner);
  EXECUTE format('CREATE ROLE rh_app LOGIN PASSWORD %L', s.senha_rh_app);
  EXECUTE format('GRANT rh_owner TO %I', current_user);
END $$;
ALTER ROLE rh_owner SET timezone = 'America/Sao_Paulo';
ALTER ROLE rh_app SET timezone = 'America/Sao_Paulo';
SELECT senha_rh_owner, senha_rh_app FROM _senhas;

-- Bloco 2: banco. Rode sozinho (CREATE DATABASE não roda junto com outros comandos).
CREATE DATABASE rh_demo OWNER rh_owner;

-- Bloco 3: fuso do banco. Rode sozinho.
ALTER DATABASE rh_demo SET timezone = 'America/Sao_Paulo';

-- Para recomeçar a demonstração do zero (apaga tudo do banco rh_demo): rode os dois comandos abaixo, um de cada vez, e
-- depois os Blocos 2 e 3; em seguida, faça um novo deploy de produção na Vercel.
-- DROP DATABASE rh_demo WITH (FORCE);
