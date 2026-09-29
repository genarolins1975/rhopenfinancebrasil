-- Rede da reserva de mesa pelo lado da linha da reserva (segunda revisão independente da Etapa 3). Nenhum serviço altera
-- pessoa, mesa, data, origem, autor ou chave de idempotência de uma reserva: realocação grava linha nova. Reserva encerrada
-- não reabre; reserva confirmada só é cancelada. A retenção da fila acompanha a oferta aberta no mesmo prazo.

CREATE OR REPLACE FUNCTION desk_booking_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_id <> OLD.employee_id OR NEW.resource_id <> OLD.resource_id OR NEW.booking_date <> OLD.booking_date
     OR NEW.origin <> OLD.origin OR NEW.actor_employee_id IS DISTINCT FROM OLD.actor_employee_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'booking_identity_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('cancelled', 'expired') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'booking_already_closed' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'booking_already_closed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER desk_booking_identity BEFORE UPDATE ON desk_booking FOR EACH ROW EXECUTE FUNCTION desk_booking_identity();--> statement-breakpoint

-- Retenção com oferta: a oferta é localizada pela retenção, qualquer que seja a origem gravada. Oferta aberta exige retenção
-- held no mesmo prazo; reserva confirmada de origem da fila exige oferta aceita; held de origem da fila exige oferta aberta.
CREATE OR REPLACE FUNCTION waitlist_hold_coherence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b desk_booking%ROWTYPE; o waitlist_offer%ROWTYPE;
BEGIN
  SELECT * INTO b FROM desk_booking WHERE id = NEW.id;
  SELECT * INTO o FROM waitlist_offer WHERE hold_booking_id = b.id;
  IF o.id IS NOT NULL AND o.status = 'open' AND NOT (b.status = 'held' AND b.hold_expires_at = o.expires_at) THEN
    RAISE EXCEPTION 'hold_incoherent' USING ERRCODE = 'P0001', DETAIL = 'oferta aberta';
  END IF;
  IF b.origin <> 'waitlist_offer' THEN RETURN NULL; END IF;
  IF b.status = 'confirmed' AND NOT (o.id IS NOT NULL AND o.status = 'accepted') THEN
    RAISE EXCEPTION 'hold_incoherent' USING ERRCODE = 'P0001', DETAIL = 'confirmed';
  ELSIF b.status = 'held' AND NOT (o.id IS NOT NULL AND o.status = 'open') THEN
    RAISE EXCEPTION 'hold_incoherent' USING ERRCODE = 'P0001', DETAIL = 'held';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- Meu time (DEC-37): autorização vale só para o gestor da época. Qualquer troca de gestor direto, por qualquer caminho
-- (edição, importação), zera a autorização; a volta ao gestor anterior também exige nova autorização.
CREATE OR REPLACE FUNCTION employee_manager_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE employee_preference SET share_with_manager = false, consented_manager_id = NULL, updated_at = now()
   WHERE employee_id = NEW.id AND (share_with_manager OR consented_manager_id IS NOT NULL);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER employee_manager_changed AFTER UPDATE OF manager_employee_id ON employee FOR EACH ROW
  WHEN (OLD.manager_employee_id IS DISTINCT FROM NEW.manager_employee_id) EXECUTE FUNCTION employee_manager_changed();
--> statement-breakpoint

-- Mesa em revisão (titular desativado): ninguém é elegível, nem pela liberação ao compartilhado. A classe acompanha e a
-- mesa deixa de contar como capacidade compartilhada nos indicadores e na oferta manual (observação da primeira revisão).
CREATE OR REPLACE FUNCTION desk_class(p_resource uuid, p_date date) RETURNS text
LANGUAGE sql STABLE AS $$
  select case
    when s.reason = 'retired' then 'retired'
    when s.reason = 'maintenance' then 'maintenance'
    when s.reason = 'blocked' then 'blocked'
    when exists (select 1 from exclusive_assignment a
                  where a.resource_id = p_resource and a.cancelled_at is null
                    and a.valid_from <= p_date and (a.valid_to is null or a.valid_to >= p_date)
                    and (a.needs_review or not exists (select 1 from access_exception x
                                     where x.assignment_id = a.id and x.revoked_at is null and x.kind = 'release_to_shared'
                                       and x.starts_on <= p_date and x.ends_on >= p_date))) then 'exclusive'
    else 'shared' end
  from (select resource_unavailable_reason(p_resource, p_date) as reason) s
$$;
