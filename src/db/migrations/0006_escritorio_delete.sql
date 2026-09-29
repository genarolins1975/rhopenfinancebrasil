-- Complemento da rede (DEC-14): o papel da aplicação também não apaga inventário, zonas, grupos, parâmetros e posições.
-- Intenção e requisição de semana, e a outbox, continuam apagáveis pela aplicação por retenção (PAR-14).
REVOKE DELETE ON resource, zone, access_group, office_settings, floor_plan_placement FROM rh_app;
