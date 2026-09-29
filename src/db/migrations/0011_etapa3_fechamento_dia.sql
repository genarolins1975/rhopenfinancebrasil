-- Correção da revisão independente da Etapa 3 (T-02): fechar o dia de hoje não pode esbarrar em reserva de sala já
-- encerrada, que não é exibida na prévia nem pode ser cancelada. Mesma regra de assert_resource_bookings_valid.
CREATE OR REPLACE FUNCTION assert_day_bookings_valid(p_date date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM desk_booking b
   WHERE b.booking_date = p_date
     AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > now()))
     AND NOT booking_remains_valid(b.employee_id, b.resource_id, b.booking_date);
  IF n > 0 THEN
    RAISE EXCEPTION 'booking_conflict' USING ERRCODE = 'P0001', DETAIL = n || ' reserva(s) de mesa no dia';
  END IF;
  SELECT count(*) INTO n FROM space_booking s
   WHERE s.status = 'confirmed' AND upper(s.period) > now() AND s.period && local_day_range(p_date) AND NOT office_open(p_date);
  IF n > 0 THEN
    RAISE EXCEPTION 'booking_conflict' USING ERRCODE = 'P0001', DETAIL = n || ' reserva(s) de sala no dia';
  END IF;
END
$$;
