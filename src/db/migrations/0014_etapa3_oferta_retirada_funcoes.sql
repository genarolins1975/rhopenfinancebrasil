-- Oferta retirada pela administração (N3): estado próprio, distinto de vencida e recusada. A retenção é cancelada na mesma
-- transação; a inscrição volta a waiting e a mesma mesa não é oferecida de novo a ela na data (regra no serviço da fila).
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
  ELSIF o.status::text IN ('declined', 'expired', 'withdrawn') AND b.status NOT IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'offer_incoherent' USING ERRCODE = 'P0001', DETAIL = 'closed';
  END IF;
  RETURN NULL;
END
$$;
