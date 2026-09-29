-- Funções de dia local. Única fonte de "hoje" em SQL; current_date é proibido no projeto.
CREATE OR REPLACE FUNCTION local_today() RETURNS date
LANGUAGE sql STABLE AS $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION local_day_range(d date) RETURNS tstzrange
LANGUAGE sql IMMUTABLE AS $$
  select tstzrange(
    make_timestamptz(extract(year from d)::int, extract(month from d)::int, extract(day from d)::int, 0, 0, 0, 'America/Sao_Paulo'),
    make_timestamptz(extract(year from d + 1)::int, extract(month from d + 1)::int, extract(day from d + 1)::int, 0, 0, 0, 'America/Sao_Paulo'),
    '[)'
  )
$$;--> statement-breakpoint
-- Papel da aplicação: sem propriedade das tabelas, sem UPDATE e DELETE em audit_event.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rh_app') THEN
    CREATE ROLE rh_app NOLOGIN;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO rh_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rh_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_event FROM rh_app;--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO rh_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE rh_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rh_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE rh_owner IN SCHEMA public GRANT USAGE ON SEQUENCES TO rh_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION local_today() TO rh_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION local_day_range(date) TO rh_app;--> statement-breakpoint
-- Seed de perfis e permissões, gerado de src/modules/access/permissions.ts em 28/09/2026.
insert into role (code, name, privileged) values
  ('employee', 'Colaborador', false),
  ('manager', 'Gestor', false),
  ('hr', 'RH', true),
  ('facilities', 'Facilities', true),
  ('admin', 'Administrador', true),
  ('tech_admin', 'Administrador técnico', true)
on conflict (code) do update set name = excluded.name, privileged = excluded.privileged;--> statement-breakpoint

insert into permission (code, description, sensitive) values
  ('booking.self.manage', 'Criar e cancelar as próprias reservas, planejar a semana, entrar na fila', false),
  ('booking.on_behalf.create', 'Reservar em nome de outra pessoa, com confirmação, registro do ator e notificação', true),
  ('booking.admin.manage', 'Cancelamento administrativo com motivo e visão de todas as reservas', true),
  ('team.view', 'Ver planos e reservas autorizadas da própria equipe', false),
  ('employee.read.basic', 'Nome, área, cargo e email corporativo', false),
  ('employee.read.full', 'Cadastro completo exceto CPF', true),
  ('employee.manage', 'Cadastrar, editar, convidar, suspender, desativar e readmitir', true),
  ('employee.import', 'Importação CSV', true),
  ('cpf.reveal', 'Revelar CPF completo, sempre com motivo e auditoria', true),
  ('role.assign.standard', 'Conceder os perfis colaborador e gestor', true),
  ('role.assign.privileged', 'Conceder perfis privilegiados e permissões sensíveis', true),
  ('resource.manage', 'Recursos, atributos e zonas', false),
  ('resource.status.manage', 'Manutenção e bloqueio administrativo', false),
  ('floorplan.edit', 'Editar versões da planta', false),
  ('floorplan.publish', 'Aprovar e publicar versão da planta', true),
  ('manage_executive_seat_assignments', 'Criar, agendar, transferir, encerrar, liberar e revisar mesas exclusivas', true),
  ('exclusive.holder.view', 'Ver o nome do titular de mesa exclusiva', true),
  ('exclusive.view', 'Ver a tela de exclusividade em modo leitura', false),
  ('waitlist.admin', 'Gerir fila e ofertas', false),
  ('ticket.self', 'Abrir e acompanhar as próprias solicitações', false),
  ('ticket.hr.handle', 'Atender a fila de RH', true),
  ('ticket.facilities.handle', 'Atender a fila de Facilities', false),
  ('ticket.it.handle', 'Atender a fila de TI', false),
  ('ticket.restricted.handle', 'Atender assuntos sensíveis', true),
  ('ticket.internal_note', 'Escrever notas internas', false),
  ('content.edit', 'Editar rascunhos de conteúdo', false),
  ('content.approve', 'Aprovar conteúdo', false),
  ('content.publish', 'Publicar conteúdo', false),
  ('survey.manage', 'Criar e configurar pesquisas', true),
  ('survey.aggregate.view', 'Ver resultados agregados com supressão', false),
  ('survey.raw.view', 'Ver respostas individuais identificadas', true),
  ('actions.manage', 'Plano de ações', false),
  ('report.view', 'Indicadores agregados', false),
  ('report.export', 'Exportar sem CPF', true),
  ('audit.view', 'Consultar auditoria', true),
  ('settings.manage', 'Configuração operacional', true),
  ('integration.manage', 'Integrações e configuração técnica', true),
  ('session.revoke.any', 'Revogar sessões de terceiros', true)
on conflict (code) do update set description = excluded.description, sensitive = excluded.sensitive;--> statement-breakpoint

delete from role_permission;--> statement-breakpoint
insert into role_permission (role_code, permission_code) values
  ('employee', 'booking.self.manage'),
  ('employee', 'employee.read.basic'),
  ('employee', 'ticket.self'),
  ('manager', 'booking.self.manage'),
  ('manager', 'employee.read.basic'),
  ('manager', 'ticket.self'),
  ('manager', 'team.view'),
  ('manager', 'report.view'),
  ('hr', 'booking.self.manage'),
  ('hr', 'employee.read.basic'),
  ('hr', 'ticket.self'),
  ('hr', 'employee.read.full'),
  ('hr', 'employee.manage'),
  ('hr', 'employee.import'),
  ('hr', 'role.assign.standard'),
  ('hr', 'manage_executive_seat_assignments'),
  ('hr', 'exclusive.holder.view'),
  ('hr', 'exclusive.view'),
  ('hr', 'ticket.hr.handle'),
  ('hr', 'ticket.internal_note'),
  ('hr', 'content.edit'),
  ('hr', 'content.approve'),
  ('hr', 'content.publish'),
  ('hr', 'survey.manage'),
  ('hr', 'survey.aggregate.view'),
  ('hr', 'actions.manage'),
  ('hr', 'report.view'),
  ('facilities', 'booking.self.manage'),
  ('facilities', 'employee.read.basic'),
  ('facilities', 'ticket.self'),
  ('facilities', 'booking.admin.manage'),
  ('facilities', 'resource.manage'),
  ('facilities', 'resource.status.manage'),
  ('facilities', 'floorplan.edit'),
  ('facilities', 'exclusive.view'),
  ('facilities', 'waitlist.admin'),
  ('facilities', 'ticket.facilities.handle'),
  ('facilities', 'ticket.internal_note'),
  ('facilities', 'content.edit'),
  ('facilities', 'actions.manage'),
  ('facilities', 'report.view'),
  ('admin', 'booking.self.manage'),
  ('admin', 'employee.read.basic'),
  ('admin', 'ticket.self'),
  ('admin', 'settings.manage'),
  ('tech_admin', 'booking.self.manage'),
  ('tech_admin', 'employee.read.basic'),
  ('tech_admin', 'ticket.self'),
  ('tech_admin', 'integration.manage'),
  ('tech_admin', 'session.revoke.any');--> statement-breakpoint
