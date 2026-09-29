-- Etapa 3: fila de espera, oferta com retenção, confirmação de uso e preferência de compartilhamento.
-- Especificação em docs/dados/modelo-de-dados.md (lista de espera) e docs/mesas-exclusivas/politica-dir.md (DIR-025, DIR-034).

-- A oferta toma o lock da mesa como as demais linhas por recurso (DEC-14).
CREATE TRIGGER waitlist_offer_lock BEFORE INSERT OR UPDATE ON waitlist_offer FOR EACH ROW EXECUTE FUNCTION lock_resource_row();--> statement-breakpoint

-- Consistência da oferta: a retenção é um desk_booking held, da mesma mesa, da pessoa e da data da inscrição, com origem
-- waitlist_offer; a inscrição precisa estar em espera no momento da oferta. Segunda rede, independente do código.
CREATE OR REPLACE FUNCTION waitlist_offer_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b desk_booking%ROWTYPE; e waitlist_entry%ROWTYPE;
BEGIN
  SELECT * INTO b FROM desk_booking WHERE id = NEW.hold_booking_id;
  SELECT * INTO e FROM waitlist_entry WHERE id = NEW.entry_id;
  IF b.id IS NULL OR e.id IS NULL THEN RAISE EXCEPTION 'offer_inconsistent' USING ERRCODE = 'P0001'; END IF;
  IF b.status <> 'held' OR b.origin <> 'waitlist_offer' OR b.resource_id <> NEW.resource_id
     OR b.employee_id <> e.employee_id OR b.booking_date <> e.date OR b.hold_expires_at <> NEW.expires_at THEN
    RAISE EXCEPTION 'offer_inconsistent' USING ERRCODE = 'P0001';
  END IF;
  IF e.status <> 'waiting' THEN RAISE EXCEPTION 'offer_entry_not_waiting' USING ERRCODE = 'P0001'; END IF;
  IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'offer_already_expired' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER waitlist_offer_consistency BEFORE INSERT ON waitlist_offer FOR EACH ROW EXECUTE FUNCTION waitlist_offer_check();--> statement-breakpoint

-- Oferta não muda de inscrição, mesa nem retenção; só o prazo, o status e a decisão.
CREATE OR REPLACE FUNCTION waitlist_offer_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_id <> OLD.entry_id OR NEW.resource_id <> OLD.resource_id OR NEW.hold_booking_id <> OLD.hold_booking_id THEN
    RAISE EXCEPTION 'offer_identity_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'open' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'offer_already_decided' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER waitlist_offer_identity BEFORE UPDATE ON waitlist_offer FOR EACH ROW EXECUTE FUNCTION waitlist_offer_identity();--> statement-breakpoint

-- Inscrição: pessoa e data não mudam; inscrição fechada não reabre.
CREATE OR REPLACE FUNCTION waitlist_entry_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_id <> OLD.employee_id OR NEW.date <> OLD.date THEN
    RAISE EXCEPTION 'entry_identity_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('accepted', 'expired', 'cancelled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'entry_already_closed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER waitlist_entry_identity BEFORE UPDATE ON waitlist_entry FOR EACH ROW EXECUTE FUNCTION waitlist_entry_identity();--> statement-breakpoint

-- Confirmação de uso (REQ-15): só da própria reserva confirmada, no dia da reserva. Declaração, nunca prova de presença.
CREATE OR REPLACE FUNCTION checkin_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ok boolean := false;
BEGIN
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
$$;--> statement-breakpoint
CREATE TRIGGER checkin_consistency BEFORE INSERT ON checkin FOR EACH ROW EXECUTE FUNCTION checkin_check();--> statement-breakpoint
CREATE OR REPLACE FUNCTION checkin_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'checkin_immutable' USING ERRCODE = 'P0001';
END
$$;--> statement-breakpoint
CREATE TRIGGER checkin_immutable BEFORE UPDATE ON checkin FOR EACH ROW EXECUTE FUNCTION checkin_frozen();--> statement-breakpoint

-- Rede (DEC-14): a aplicação não apaga fila, oferta nem confirmação de uso. Preferência é da pessoa e pode ser apagada por retenção.
REVOKE DELETE ON waitlist_entry, waitlist_offer, checkin FROM rh_app;--> statement-breakpoint

-- Parâmetros da etapa (PAR-05, PAR-06, horas úteis do escritório).
INSERT INTO office_settings (key, value) VALUES
  ('offer_minutes', '120'::jsonb),
  ('business_hours_start', '"09:00"'::jsonb),
  ('business_hours_end', '"18:00"'::jsonb),
  ('checkin_release_enabled', 'false'::jsonb),
  ('checkin_release_time', '"11:00"'::jsonb)
ON CONFLICT (key) DO NOTHING;
