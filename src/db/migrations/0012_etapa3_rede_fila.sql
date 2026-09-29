-- Rede independente da fila de espera (revisão independente da Etapa 3, BDT-04). O banco garante, sem depender do código:
-- ordem de entrada imutável, oferta nascida só de inscrição reivindicada, campos de oferta e inscrição decididas congelados,
-- coerência entre oferta, retenção e inscrição no commit, retenção da fila só vira reserva com oferta aceita e confirmação de
-- uso datada pelo relógio do banco.

CREATE OR REPLACE FUNCTION waitlist_entry_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_id <> OLD.employee_id OR NEW.date <> OLD.date OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'entry_identity_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('accepted', 'expired', 'cancelled') AND (NEW.status <> OLD.status
       OR NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
       OR NEW.close_reason IS DISTINCT FROM OLD.close_reason OR NEW.preferences <> OLD.preferences) THEN
    RAISE EXCEPTION 'entry_already_closed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION waitlist_entry_insert_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'waiting' THEN RAISE EXCEPTION 'entry_must_start_waiting' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER waitlist_entry_insert BEFORE INSERT ON waitlist_entry FOR EACH ROW EXECUTE FUNCTION waitlist_entry_insert_check();--> statement-breakpoint

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
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Coerência no commit, vista a partir da oferta: aberta com retenção viva ou vencida (a leitura ignora a vencida) no mesmo prazo
-- e inscrição offered; aceita com reserva confirmada e inscrição accepted; recusada ou vencida sem retenção ativa.
CREATE OR REPLACE FUNCTION waitlist_offer_coherence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o waitlist_offer%ROWTYPE; b desk_booking%ROWTYPE; e waitlist_entry%ROWTYPE;
BEGIN
  SELECT * INTO o FROM waitlist_offer WHERE id = NEW.id;
  SELECT * INTO b FROM desk_booking WHERE id = o.hold_booking_id;
  SELECT * INTO e FROM waitlist_entry WHERE id = o.entry_id;
  IF o.status = 'open' AND NOT (b.status = 'held' AND b.hold_expires_at = o.expires_at AND e.status = 'offered') THEN
    RAISE EXCEPTION 'offer_incoherent' USING ERRCODE = 'P0001', DETAIL = 'open';
  ELSIF o.status = 'accepted' AND NOT (b.status = 'confirmed' AND e.status = 'accepted') THEN
    RAISE EXCEPTION 'offer_incoherent' USING ERRCODE = 'P0001', DETAIL = 'accepted';
  ELSIF o.status IN ('declined', 'expired') AND b.status NOT IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'offer_incoherent' USING ERRCODE = 'P0001', DETAIL = 'closed';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER waitlist_offer_coherence AFTER INSERT OR UPDATE ON waitlist_offer
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION waitlist_offer_coherence();--> statement-breakpoint

-- Inscrição: offered só com oferta aberta; accepted só com oferta aceita; oferta aberta só com inscrição offered.
CREATE OR REPLACE FUNCTION waitlist_entry_coherence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM waitlist_entry WHERE id = NEW.id;
  IF st = 'offered' AND NOT EXISTS (SELECT 1 FROM waitlist_offer o WHERE o.entry_id = NEW.id AND o.status = 'open') THEN
    RAISE EXCEPTION 'entry_incoherent' USING ERRCODE = 'P0001', DETAIL = 'offered';
  ELSIF st = 'accepted' AND NOT EXISTS (SELECT 1 FROM waitlist_offer o WHERE o.entry_id = NEW.id AND o.status = 'accepted') THEN
    RAISE EXCEPTION 'entry_incoherent' USING ERRCODE = 'P0001', DETAIL = 'accepted';
  ELSIF st <> 'offered' AND EXISTS (SELECT 1 FROM waitlist_offer o WHERE o.entry_id = NEW.id AND o.status = 'open') THEN
    RAISE EXCEPTION 'entry_incoherent' USING ERRCODE = 'P0001', DETAIL = 'oferta aberta';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER waitlist_entry_coherence AFTER INSERT OR UPDATE ON waitlist_entry
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION waitlist_entry_coherence();--> statement-breakpoint

-- Retenção da fila: confirmed só com oferta aceita; held só com oferta aberta (nasce na mesma transação da oferta).
CREATE OR REPLACE FUNCTION waitlist_hold_coherence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b desk_booking%ROWTYPE;
BEGIN
  SELECT * INTO b FROM desk_booking WHERE id = NEW.id;
  IF b.origin <> 'waitlist_offer' THEN RETURN NULL; END IF;
  IF b.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM waitlist_offer o WHERE o.hold_booking_id = b.id AND o.status = 'accepted') THEN
    RAISE EXCEPTION 'hold_incoherent' USING ERRCODE = 'P0001', DETAIL = 'confirmed';
  ELSIF b.status = 'held' AND NOT EXISTS (SELECT 1 FROM waitlist_offer o WHERE o.hold_booking_id = b.id AND o.status = 'open') THEN
    RAISE EXCEPTION 'hold_incoherent' USING ERRCODE = 'P0001', DETAIL = 'held';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER desk_booking_waitlist_coherence AFTER INSERT OR UPDATE ON desk_booking
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION waitlist_hold_coherence();--> statement-breakpoint

-- Confirmação de uso: instante do banco, nunca informado por quem grava.
CREATE OR REPLACE FUNCTION checkin_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ok boolean := false;
BEGIN
  NEW.declared_at := now();
  IF NEW.desk_booking_id IS NOT NULL THEN
    SELECT true INTO ok FROM desk_booking b
     WHERE b.id = NEW.desk_booking_id AND b.status = 'confirmed' AND b.employee_id = NEW.actor_employee_id AND b.booking_date = local_today();
  ELSIF NEW.space_booking_id IS NOT NULL THEN
    SELECT true INTO ok FROM space_booking s
     WHERE s.id = NEW.space_booking_id AND s.status = 'confirmed' AND s.employee_id = NEW.actor_employee_id
       AND local_today() IN (SELECT * FROM local_dates_of(s.period));
  END IF;
  IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'checkin_not_allowed' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END
$$;
