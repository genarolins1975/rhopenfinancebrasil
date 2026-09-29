-- Rede de prazos e encerramentos (terceira revisão independente da Etapa 3). A oferta nasce com prazo no máximo até o fim
-- do dia local da data da inscrição (PAR-05, PAR-43) e, aberta, só pode ter o prazo encurtado: nenhum serviço estende
-- prazo, e estender reabriria oferta vencida. Reserva cancelada ou vencida tem o encerramento congelado.

CREATE OR REPLACE FUNCTION waitlist_offer_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b desk_booking%ROWTYPE; e waitlist_entry%ROWTYPE;
BEGIN
  SELECT * INTO b FROM desk_booking WHERE id = NEW.hold_booking_id;
  SELECT * INTO e FROM waitlist_entry WHERE id = NEW.entry_id;
  IF b.id IS NULL OR e.id IS NULL THEN RAISE EXCEPTION 'offer_inconsistent' USING ERRCODE = 'P0001'; END IF;
  IF NEW.status <> 'open' OR NEW.decided_at IS NOT NULL THEN RAISE EXCEPTION 'offer_inconsistent' USING ERRCODE = 'P0001'; END IF;
  IF b.status <> 'held' OR b.origin <> 'waitlist_offer' OR b.resource_id <> NEW.resource_id
     OR b.employee_id <> e.employee_id OR b.booking_date <> e.date OR b.hold_expires_at <> NEW.expires_at THEN
    RAISE EXCEPTION 'offer_inconsistent' USING ERRCODE = 'P0001';
  END IF;
  -- A transação que oferece reivindica a inscrição (waiting para offered) antes de gravar a oferta.
  IF e.status <> 'offered' THEN RAISE EXCEPTION 'offer_entry_not_waiting' USING ERRCODE = 'P0001'; END IF;
  IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'offer_already_expired' USING ERRCODE = 'P0001'; END IF;
  IF NEW.expires_at > upper(local_day_range(e.date)) THEN RAISE EXCEPTION 'offer_beyond_day' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION waitlist_offer_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_id <> OLD.entry_id OR NEW.resource_id <> OLD.resource_id OR NEW.hold_booking_id <> OLD.hold_booking_id
     OR NEW.offered_at <> OLD.offered_at OR NEW.offered_by IS DISTINCT FROM OLD.offered_by THEN
    RAISE EXCEPTION 'offer_identity_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'open' AND (NEW.status <> OLD.status OR NEW.expires_at <> OLD.expires_at OR NEW.decided_at IS DISTINCT FROM OLD.decided_at) THEN
    RAISE EXCEPTION 'offer_already_decided' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'open' AND NEW.expires_at > OLD.expires_at THEN
    RAISE EXCEPTION 'offer_deadline_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION desk_booking_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_id <> OLD.employee_id OR NEW.resource_id <> OLD.resource_id OR NEW.booking_date <> OLD.booking_date
     OR NEW.origin <> OLD.origin OR NEW.actor_employee_id IS DISTINCT FROM OLD.actor_employee_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'booking_identity_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('cancelled', 'expired') AND (NEW.status <> OLD.status OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION 'booking_already_closed' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'booking_already_closed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
