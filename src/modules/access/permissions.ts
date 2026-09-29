/**
 * Catálogo de permissões e perfis. Fonte única: docs/permissoes/matriz-de-permissoes.md.
 * A migração de seed é gerada a partir deste arquivo; qualquer mudança exige nova migração.
 */
export const PERMISSIONS = {
  "booking.self.manage": { description: "Criar e cancelar as próprias reservas, planejar a semana, entrar na fila", sensitive: false },
  "booking.on_behalf.create": { description: "Reservar em nome de outra pessoa, com confirmação, registro do ator e notificação", sensitive: true },
  "booking.admin.manage": { description: "Cancelamento administrativo com motivo e visão de todas as reservas", sensitive: true },
  "team.view": { description: "Ver planos e reservas autorizadas da própria equipe", sensitive: false },
  "employee.read.basic": { description: "Nome, área, cargo e email corporativo", sensitive: false },
  "employee.read.full": { description: "Cadastro completo exceto CPF", sensitive: true },
  "employee.manage": { description: "Cadastrar, editar, convidar, suspender, desativar e readmitir", sensitive: true },
  "employee.import": { description: "Importação CSV", sensitive: true },
  "cpf.reveal": { description: "Revelar CPF completo, sempre com motivo e auditoria", sensitive: true },
  "role.assign.standard": { description: "Conceder os perfis colaborador e gestor", sensitive: true },
  "role.assign.privileged": { description: "Conceder perfis privilegiados e permissões sensíveis", sensitive: true },
  "resource.manage": { description: "Recursos, atributos e zonas", sensitive: false },
  "resource.status.manage": { description: "Manutenção e bloqueio administrativo", sensitive: false },
  "floorplan.edit": { description: "Editar versões da planta", sensitive: false },
  "floorplan.publish": { description: "Aprovar e publicar versão da planta", sensitive: true },
  manage_executive_seat_assignments: { description: "Criar, agendar, transferir, encerrar, liberar e revisar mesas exclusivas", sensitive: true },
  "exclusive.holder.view": { description: "Ver o nome do titular de mesa exclusiva", sensitive: true },
  "exclusive.view": { description: "Ver a tela de exclusividade em modo leitura", sensitive: false },
  "waitlist.admin": { description: "Gerir fila e ofertas", sensitive: false },
  "ticket.self": { description: "Abrir e acompanhar as próprias solicitações", sensitive: false },
  "ticket.hr.handle": { description: "Atender a fila de RH", sensitive: true },
  "ticket.facilities.handle": { description: "Atender a fila de Facilities", sensitive: false },
  "ticket.it.handle": { description: "Atender a fila de TI", sensitive: false },
  "ticket.restricted.handle": { description: "Atender assuntos sensíveis", sensitive: true },
  "ticket.internal_note": { description: "Escrever notas internas", sensitive: false },
  "content.edit": { description: "Editar rascunhos de conteúdo", sensitive: false },
  "content.approve": { description: "Aprovar conteúdo", sensitive: false },
  "content.publish": { description: "Publicar conteúdo", sensitive: false },
  "survey.manage": { description: "Criar e configurar pesquisas", sensitive: true },
  "survey.aggregate.view": { description: "Ver resultados agregados com supressão", sensitive: false },
  "survey.raw.view": { description: "Ver respostas individuais identificadas", sensitive: true },
  "actions.manage": { description: "Plano de ações", sensitive: false },
  "report.view": { description: "Indicadores agregados", sensitive: false },
  "report.export": { description: "Exportar sem CPF", sensitive: true },
  "audit.view": { description: "Consultar auditoria", sensitive: true },
  "settings.manage": { description: "Configuração operacional", sensitive: true },
  "integration.manage": { description: "Integrações e configuração técnica", sensitive: true },
  "session.revoke.any": { description: "Revogar sessões de terceiros", sensitive: true },
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLES = {
  employee: { name: "Colaborador", privileged: false },
  manager: { name: "Gestor", privileged: false },
  hr: { name: "RH", privileged: true },
  facilities: { name: "Facilities", privileged: true },
  admin: { name: "Administrador", privileged: true },
  tech_admin: { name: "Administrador técnico", privileged: true },
} as const;

export type Role = keyof typeof ROLES;

const BASE: Permission[] = ["booking.self.manage", "employee.read.basic", "ticket.self"];

/** Permissões concedidas por perfil (marca S da matriz). Tudo o mais é concessão explícita. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  employee: [...BASE],
  manager: [...BASE, "team.view", "report.view"],
  hr: [
    ...BASE,
    "employee.read.full",
    "employee.manage",
    "employee.import",
    "role.assign.standard",
    "manage_executive_seat_assignments",
    "exclusive.holder.view",
    "exclusive.view",
    "ticket.hr.handle",
    "ticket.internal_note",
    "content.edit",
    "content.approve",
    "content.publish",
    "survey.manage",
    "survey.aggregate.view",
    "actions.manage",
    "report.view",
  ],
  facilities: [
    ...BASE,
    "booking.admin.manage",
    "resource.manage",
    "resource.status.manage",
    "floorplan.edit",
    "exclusive.view",
    "waitlist.admin",
    "ticket.facilities.handle",
    "ticket.internal_note",
    "content.edit",
    "actions.manage",
    "report.view",
  ],
  admin: [...BASE, "settings.manage"],
  tech_admin: [...BASE, "integration.manage", "session.revoke.any"],
};

export const PRIVILEGED_ROLES: Role[] = (Object.keys(ROLES) as Role[]).filter((r) => ROLES[r].privileged);

/** Permissões que só podem ser concedidas por quem tem role.assign.privileged. */
export function isSensitivePermission(p: Permission): boolean {
  return PERMISSIONS[p].sensitive;
}

/** Permissões que dão acesso ao ambiente administrativo. */
export const ADMIN_AREA_PERMISSIONS: Permission[] = [
  "employee.manage",
  "employee.import",
  "employee.read.full",
  "role.assign.standard",
  "role.assign.privileged",
  "resource.manage",
  "resource.status.manage",
  "floorplan.edit",
  "floorplan.publish",
  "manage_executive_seat_assignments",
  "exclusive.view",
  "waitlist.admin",
  "booking.admin.manage",
  "ticket.hr.handle",
  "ticket.facilities.handle",
  "ticket.it.handle",
  "content.edit",
  "survey.manage",
  "actions.manage",
  "audit.view",
  "settings.manage",
  "integration.manage",
  "session.revoke.any",
];
