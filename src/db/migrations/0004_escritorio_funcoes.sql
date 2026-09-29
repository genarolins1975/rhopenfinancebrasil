-- Escritório: constraints de exclusão, funções compartilhadas, triggers de lock, validação e verificação deferida,
-- grants e valores iniciais. Especificação em docs/dados/modelo-de-dados.md e docs/mesas-exclusivas/politica-dir.md.

-- Vigência efetiva de um período operacional: semiaberto, vazio quando liberado no próprio dia de início.
CREATE OR REPLACE FUNCTION period_range(p_starts date, p_ends date, p_released date) RETURNS daterange
LANGUAGE sql IMMUTABLE AS $$
  select daterange(p_starts, least(p_ends + 1, p_released), '[)')
$$;--> statement-breakpoint

ALTER TABLE space_booking ADD CONSTRAINT space_booking_no_overlap
  EXCLUDE USING gist (resource_id WITH =, period WITH &&) WHERE (status = 'confirmed');--> statement-breakpoint
ALTER TABLE exclusive_assignment ADD CONSTRAINT exclusive_assignment_no_overlap
  EXCLUDE USING gist (resource_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&) WHERE (cancelled_at IS NULL);--> statement-breakpoint
ALTER TABLE access_exception ADD CONSTRAINT access_exception_no_overlap
  EXCLUDE USING gist (resource_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&) WHERE (revoked_at IS NULL);--> statement-breakpoint
ALTER TABLE resource_status_period ADD CONSTRAINT resource_status_no_overlap
  EXCLUDE USING gist (resource_id WITH =, status WITH =, period_range(starts_on, ends_on, released_on) WITH &&);--> statement-breakpoint

-- Configurações tipadas.
CREATE OR REPLACE FUNCTION office_setting_int(p_key text, p_default int) RETURNS int
LANGUAGE sql STABLE AS $$
  select coalesce((select (value #>> '{}')::int from office_settings where key = p_key), p_default)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION office_setting_text(p_key text, p_default text) RETURNS text
LANGUAGE sql STABLE AS $$
  select coalesce((select value #>> '{}' from office_settings where key = p_key), p_default)
$$;--> statement-breakpoint

-- Estado da atribuição, derivado da vigência; nunca gravado.
CREATE OR REPLACE FUNCTION assignment_state(a exclusive_assignment, p_today date) RETURNS text
LANGUAGE sql STABLE AS $$
  select case
    when a.cancelled_at is not null then 'cancelled'
    when a.valid_from > p_today then 'scheduled'
    when a.valid_to is not null and a.valid_to < p_today then 'ended'
    else 'active' end
$$;--> statement-breakpoint

-- Situação operacional do recurso numa data: retired, maintenance, blocked ou nulo.
CREATE OR REPLACE FUNCTION resource_unavailable_reason(p_resource uuid, p_date date) RETURNS text
LANGUAGE sql STABLE AS $$
  select case
    when r.retired_on is not null and r.retired_on <= p_date then 'retired'
    when exists (select 1 from resource_status_period p where p.resource_id = r.id and p.status = 'maintenance'
                 and period_range(p.starts_on, p.ends_on, p.released_on) @> p_date) then 'maintenance'
    when exists (select 1 from resource_status_period p where p.resource_id = r.id and p.status = 'admin_block'
                 and period_range(p.starts_on, p.ends_on, p.released_on) @> p_date) then 'blocked'
    else null end
  from resource r where r.id = p_resource
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION office_open(p_date date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  select coalesce((select is_open from office_calendar where date = p_date), true)
$$;--> statement-breakpoint

-- Regra literal de DIR-031. Única fonte de elegibilidade: o serviço de disponibilidade é testado contra ela.
CREATE OR REPLACE FUNCTION is_eligible(p_employee uuid, p_resource uuid, p_date date) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  a exclusive_assignment%rowtype;
  x access_exception%rowtype;
BEGIN
  SELECT * INTO a FROM exclusive_assignment
   WHERE resource_id = p_resource AND cancelled_at IS NULL AND valid_from <= p_date AND (valid_to IS NULL OR valid_to >= p_date)
   LIMIT 1;
  IF NOT FOUND THEN RETURN true; END IF;
  IF a.mode = 'individual' AND a.needs_review THEN RETURN false; END IF;
  SELECT * INTO x FROM access_exception
   WHERE assignment_id = a.id AND revoked_at IS NULL AND starts_on <= p_date AND ends_on >= p_date
   LIMIT 1;
  IF FOUND THEN
    IF x.kind = 'release_to_shared' THEN RETURN true; END IF;
    RETURN x.beneficiary_employee_id = p_employee;
  END IF;
  IF a.mode = 'individual' THEN RETURN a.holder_employee_id = p_employee; END IF;
  RETURN EXISTS (SELECT 1 FROM access_group_member m
                  WHERE m.group_id = a.access_group_id AND m.employee_id = p_employee
                    AND m.valid_from <= p_date AND (m.valid_to IS NULL OR m.valid_to >= p_date));
END
$$;--> statement-breakpoint

-- Passos 1 a 6 de DIR-019 para reserva nova (sem a checagem de permissão, que é da aplicação).
CREATE OR REPLACE FUNCTION is_bookable(p_employee uuid, p_resource uuid, p_date date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  select coalesce((select status = 'active' from employee where id = p_employee), false)
     and office_open(p_date)
     and resource_unavailable_reason(p_resource, p_date) is null
     and is_eligible(p_employee, p_resource, p_date)
$$;--> statement-breakpoint

-- Mesma regra para reserva já existente: pessoa suspensa mantém reservas.
CREATE OR REPLACE FUNCTION booking_remains_valid(p_employee uuid, p_resource uuid, p_date date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  select coalesce((select status in ('active', 'suspended') from employee where id = p_employee), false)
     and office_open(p_date)
     and resource_unavailable_reason(p_resource, p_date) is null
     and is_eligible(p_employee, p_resource, p_date)
$$;--> statement-breakpoint

-- Classe da mesa numa data, base de todos os indicadores (DIR-026).
CREATE OR REPLACE FUNCTION desk_class(p_resource uuid, p_date date) RETURNS text
LANGUAGE sql STABLE AS $$
  select case
    when s.reason = 'retired' then 'retired'
    when s.reason = 'maintenance' then 'maintenance'
    when s.reason = 'blocked' then 'blocked'
    when exists (select 1 from exclusive_assignment a
                  where a.resource_id = p_resource and a.cancelled_at is null
                    and a.valid_from <= p_date and (a.valid_to is null or a.valid_to >= p_date)
                    and not exists (select 1 from access_exception x
                                     where x.assignment_id = a.id and x.revoked_at is null and x.kind = 'release_to_shared'
                                       and x.starts_on <= p_date and x.ends_on >= p_date)) then 'exclusive'
    else 'shared' end
  from (select resource_unavailable_reason(p_resource, p_date) as reason) s
$$;--> statement-breakpoint

-- Janela de abertura (PAR-01): a semana de uma data abre no dia e hora configurados da semana anterior, em horário local.
CREATE OR REPLACE FUNCTION booking_window_opens_at(p_date date) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
DECLARE
  wk_start date := p_date - (extract(isodow from p_date)::int - 1);
  open_wd int := office_setting_int('booking_open_weekday', 4);
  open_t time := office_setting_text('booking_open_time', '10:00')::time;
  open_day date;
BEGIN
  open_day := wk_start - 7 + (open_wd - 1);
  RETURN make_timestamptz(extract(year from open_day)::int, extract(month from open_day)::int, extract(day from open_day)::int,
                          extract(hour from open_t)::int, extract(minute from open_t)::int, 0, 'America/Sao_Paulo');
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION booking_window_open(p_date date, p_now timestamptz) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  today date := (p_now at time zone 'America/Sao_Paulo')::date;
  horizon int := office_setting_int('booking_horizon_weeks', 4);
  wk_today date;
  wk_date date;
  weeks_ahead int;
BEGIN
  IF p_date < today THEN RETURN false; END IF;
  wk_today := today - (extract(isodow from today)::int - 1);
  wk_date := p_date - (extract(isodow from p_date)::int - 1);
  weeks_ahead := (wk_date - wk_today) / 7;
  IF weeks_ahead > horizon THEN RETURN false; END IF;
  IF weeks_ahead <= 0 THEN RETURN true; END IF;
  RETURN p_now >= booking_window_opens_at(p_date);
END
$$;--> statement-breakpoint

-- Dias locais cobertos por um intervalo de sala ou cabine.
CREATE OR REPLACE FUNCTION local_dates_of(p_period tstzrange) RETURNS SETOF date
LANGUAGE sql IMMUTABLE AS $$
  select d::date from generate_series(
    (lower(p_period) at time zone 'America/Sao_Paulo')::date,
    ((upper(p_period) - interval '1 microsecond') at time zone 'America/Sao_Paulo')::date,
    interval '1 day') d
$$;--> statement-breakpoint

-- Verificação deferida: nenhuma reserva ativa a partir de p_from pode ficar incompatível no recurso.
CREATE OR REPLACE FUNCTION assert_resource_bookings_valid(p_resource uuid, p_from date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM desk_booking b
   WHERE b.resource_id = p_resource AND b.booking_date >= p_from
     AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > now()))
     AND NOT booking_remains_valid(b.employee_id, b.resource_id, b.booking_date);
  IF n > 0 THEN
    RAISE EXCEPTION 'booking_conflict' USING ERRCODE = 'P0001', DETAIL = n || ' reserva(s) de mesa incompatível(is)';
  END IF;
  SELECT count(*) INTO n FROM space_booking s
   WHERE s.resource_id = p_resource AND s.status = 'confirmed' AND upper(s.period) > now()
     AND EXISTS (SELECT 1 FROM local_dates_of(s.period) d
                  WHERE d >= p_from AND (resource_unavailable_reason(p_resource, d) IS NOT NULL OR NOT office_open(d)));
  IF n > 0 THEN
    RAISE EXCEPTION 'booking_conflict' USING ERRCODE = 'P0001', DETAIL = n || ' reserva(s) de sala incompatível(is)';
  END IF;
END
$$;--> statement-breakpoint

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
   WHERE s.status = 'confirmed' AND s.period && local_day_range(p_date) AND NOT office_open(p_date);
  IF n > 0 THEN
    RAISE EXCEPTION 'booking_conflict' USING ERRCODE = 'P0001', DETAIL = n || ' reserva(s) de sala no dia';
  END IF;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION assert_employee_bookings_valid(p_employee uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM desk_booking b
   WHERE b.employee_id = p_employee AND b.booking_date >= local_today()
     AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > now()))
     AND NOT booking_remains_valid(b.employee_id, b.resource_id, b.booking_date);
  IF n > 0 THEN
    RAISE EXCEPTION 'booking_conflict' USING ERRCODE = 'P0001', DETAIL = n || ' reserva(s) futura(s) da pessoa';
  END IF;
END
$$;--> statement-breakpoint

-- Triggers de lock: o banco impõe a serialização por recurso, independentemente da disciplina do código.
CREATE OR REPLACE FUNCTION lock_resource_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.resource_id <> OLD.resource_id THEN
    PERFORM 1 FROM resource WHERE id IN (NEW.resource_id, OLD.resource_id) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM 1 FROM resource WHERE id = NEW.resource_id FOR UPDATE;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- desk_booking: além do recurso, lock compartilhado do dia; expiração preguiçosa de retenção não trava mesas de terceiros.
CREATE OR REPLACE FUNCTION lock_desk_booking() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'held' AND NEW.status IN ('expired', 'cancelled')
     AND NEW.resource_id = OLD.resource_id AND NEW.booking_date = OLD.booking_date THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtext('office_day:' || NEW.booking_date::text));
  IF TG_OP = 'UPDATE' AND NEW.resource_id <> OLD.resource_id THEN
    PERFORM 1 FROM resource WHERE id IN (NEW.resource_id, OLD.resource_id) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM 1 FROM resource WHERE id = NEW.resource_id FOR UPDATE;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION lock_space_booking() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d date;
BEGIN
  FOR d IN SELECT * FROM local_dates_of(NEW.period) LOOP
    PERFORM pg_advisory_xact_lock_shared(hashtext('office_day:' || d::text));
  END LOOP;
  PERFORM 1 FROM resource WHERE id = NEW.resource_id FOR UPDATE;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION lock_office_day() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('office_day:' || NEW.date::text));
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION lock_employee_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM employee WHERE id = NEW.id FOR UPDATE;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION lock_access_group() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM access_group WHERE id = NEW.group_id FOR UPDATE;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER desk_booking_lock BEFORE INSERT OR UPDATE ON desk_booking FOR EACH ROW EXECUTE FUNCTION lock_desk_booking();--> statement-breakpoint
CREATE TRIGGER space_booking_lock BEFORE INSERT OR UPDATE ON space_booking FOR EACH ROW EXECUTE FUNCTION lock_space_booking();--> statement-breakpoint
CREATE TRIGGER exclusive_assignment_lock BEFORE INSERT OR UPDATE ON exclusive_assignment FOR EACH ROW EXECUTE FUNCTION lock_resource_row();--> statement-breakpoint
CREATE TRIGGER access_exception_lock BEFORE INSERT OR UPDATE ON access_exception FOR EACH ROW EXECUTE FUNCTION lock_resource_row();--> statement-breakpoint
CREATE TRIGGER resource_status_period_lock BEFORE INSERT OR UPDATE ON resource_status_period FOR EACH ROW EXECUTE FUNCTION lock_resource_row();--> statement-breakpoint
CREATE TRIGGER office_calendar_lock BEFORE INSERT OR UPDATE ON office_calendar FOR EACH ROW EXECUTE FUNCTION lock_office_day();--> statement-breakpoint
CREATE TRIGGER employee_status_lock BEFORE UPDATE OF status ON employee FOR EACH ROW EXECUTE FUNCTION lock_employee_row();--> statement-breakpoint
CREATE TRIGGER access_group_member_lock BEFORE INSERT OR UPDATE ON access_group_member FOR EACH ROW EXECUTE FUNCTION lock_access_group();--> statement-breakpoint

-- Vigência da atribuição (DIR-036): estado derivado; início e término com regras fixas; linha encerrada ou anulada congelada.
CREATE OR REPLACE FUNCTION exclusive_assignment_validity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE today date := local_today();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.valid_from < today AND coalesce(current_setting('rh.allow_backdated', true), '') <> 'on' THEN
      RAISE EXCEPTION 'assignment_starts_in_past' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.cancelled_at IS NOT NULL OR NEW.ended_by IS NOT NULL THEN
      RAISE EXCEPTION 'assignment_created_closed' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.cancelled_at IS NOT NULL THEN
    IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.valid_from <> OLD.valid_from OR NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
      RAISE EXCEPTION 'assignment_cancelled_frozen' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.valid_to IS NOT NULL AND OLD.valid_to < today THEN
    IF NEW.valid_from <> OLD.valid_from OR NEW.valid_to IS DISTINCT FROM OLD.valid_to OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'assignment_ended_frozen' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.valid_from <> OLD.valid_from THEN
    IF OLD.valid_from <= today THEN RAISE EXCEPTION 'assignment_start_immutable' USING ERRCODE = 'P0001'; END IF;
    IF NEW.valid_from < today THEN RAISE EXCEPTION 'assignment_start_in_past' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF OLD.valid_to IS NOT NULL AND NEW.valid_to IS NULL THEN
    RAISE EXCEPTION 'assignment_reopen_forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    IF NEW.end_reason = 'transferred' THEN
      IF NEW.valid_to < today - 1 THEN RAISE EXCEPTION 'assignment_end_in_past' USING ERRCODE = 'P0001'; END IF;
    ELSIF NEW.valid_to < today THEN
      RAISE EXCEPTION 'assignment_end_in_past' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM access_exception x WHERE x.assignment_id = NEW.id AND x.revoked_at IS NULL AND x.ends_on > NEW.valid_to) THEN
      RAISE EXCEPTION 'exception_outside_assignment' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL AND OLD.valid_from <= today THEN
    RAISE EXCEPTION 'assignment_cancel_only_before_start' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER exclusive_assignment_validity BEFORE INSERT OR UPDATE ON exclusive_assignment FOR EACH ROW EXECUTE FUNCTION exclusive_assignment_validity();--> statement-breakpoint

-- Exceção dentro da vigência, na mesma mesa, com duração máxima (PAR-35) e beneficiário distinto do titular.
CREATE OR REPLACE FUNCTION access_exception_validity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a exclusive_assignment%rowtype;
BEGIN
  SELECT * INTO a FROM exclusive_assignment WHERE id = NEW.assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment_not_found' USING ERRCODE = 'P0002'; END IF;
  IF a.resource_id <> NEW.resource_id THEN RAISE EXCEPTION 'exception_resource_mismatch' USING ERRCODE = 'P0001'; END IF;
  IF a.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'exception_on_cancelled_assignment' USING ERRCODE = 'P0001'; END IF;
  IF NOT (daterange(NEW.starts_on, NEW.ends_on, '[]') <@ daterange(a.valid_from, a.valid_to, '[]')) THEN
    RAISE EXCEPTION 'exception_outside_assignment' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.ends_on - NEW.starts_on + 1 > office_setting_int('exception_max_days', 30) THEN
    RAISE EXCEPTION 'exception_too_long' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.starts_on < local_today() AND coalesce(current_setting('rh.allow_backdated', true), '') <> 'on' THEN
    RAISE EXCEPTION 'exception_starts_in_past' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.kind = 'release_to_employee' AND a.mode = 'individual' AND NEW.beneficiary_employee_id = a.holder_employee_id THEN
    RAISE EXCEPTION 'beneficiary_is_holder' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER access_exception_validity BEFORE INSERT OR UPDATE ON access_exception FOR EACH ROW EXECUTE FUNCTION access_exception_validity();--> statement-breakpoint

-- Transferência: uma única função encerra a antiga e cria a sucessora contígua na mesma mesa.
CREATE OR REPLACE FUNCTION transfer_assignment(p_old uuid, p_new_holder uuid, p_from date, p_reason text, p_responsible text, p_actor uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE old_row exclusive_assignment%rowtype; new_id uuid; today date := local_today();
BEGIN
  SELECT * INTO old_row FROM exclusive_assignment WHERE id = p_old FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment_not_found' USING ERRCODE = 'P0002'; END IF;
  IF old_row.mode <> 'individual' THEN RAISE EXCEPTION 'transfer_requires_individual' USING ERRCODE = 'P0001'; END IF;
  IF old_row.cancelled_at IS NOT NULL OR (old_row.valid_to IS NOT NULL AND old_row.valid_to < today) THEN
    RAISE EXCEPTION 'assignment_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF p_from < today THEN RAISE EXCEPTION 'transfer_in_past' USING ERRCODE = 'P0001'; END IF;
  IF p_from <= old_row.valid_from THEN RAISE EXCEPTION 'transfer_before_start' USING ERRCODE = 'P0001'; END IF;
  IF old_row.valid_to IS NOT NULL AND old_row.valid_to < p_from THEN RAISE EXCEPTION 'transfer_after_end' USING ERRCODE = 'P0001'; END IF;
  IF p_new_holder = old_row.holder_employee_id THEN RAISE EXCEPTION 'transfer_same_holder' USING ERRCODE = 'P0001'; END IF;
  UPDATE exclusive_assignment SET valid_to = p_from - 1, ended_by = p_actor, end_reason = 'transferred' WHERE id = p_old;
  INSERT INTO exclusive_assignment (resource_id, mode, holder_employee_id, valid_from, valid_to, reason, responsible, created_by, transferred_from_id)
    VALUES (old_row.resource_id, 'individual', p_new_holder, p_from, old_row.valid_to, p_reason, p_responsible, p_actor, p_old)
    RETURNING id INTO new_id;
  RETURN new_id;
END
$$;--> statement-breakpoint

-- Verificações deferidas: rodam no commit, com snapshot posterior aos locks.
CREATE OR REPLACE FUNCTION desk_booking_check_deferred() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'confirmed' OR (NEW.status = 'held' AND NEW.hold_expires_at > now()) THEN
    IF NOT is_bookable(NEW.employee_id, NEW.resource_id, NEW.booking_date) THEN
      RAISE EXCEPTION 'booking_not_allowed' USING ERRCODE = 'P0001', DETAIL = 'desk_booking ' || NEW.id;
    END IF;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER desk_booking_deferred AFTER INSERT OR UPDATE ON desk_booking
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION desk_booking_check_deferred();--> statement-breakpoint

CREATE OR REPLACE FUNCTION space_booking_check_deferred() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'confirmed' AND EXISTS (
       SELECT 1 FROM local_dates_of(NEW.period) d
        WHERE resource_unavailable_reason(NEW.resource_id, d) IS NOT NULL OR NOT office_open(d)) THEN
    RAISE EXCEPTION 'booking_not_allowed' USING ERRCODE = 'P0001', DETAIL = 'space_booking ' || NEW.id;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER space_booking_deferred AFTER INSERT OR UPDATE ON space_booking
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION space_booking_check_deferred();--> statement-breakpoint

CREATE OR REPLACE FUNCTION resource_policy_check_deferred() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_resource_bookings_valid(NEW.resource_id, local_today());
  IF TG_OP = 'UPDATE' AND NEW.resource_id <> OLD.resource_id THEN
    PERFORM assert_resource_bookings_valid(OLD.resource_id, local_today());
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exclusive_assignment_deferred AFTER INSERT OR UPDATE ON exclusive_assignment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resource_policy_check_deferred();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER access_exception_deferred AFTER INSERT OR UPDATE ON access_exception
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resource_policy_check_deferred();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER resource_status_period_deferred AFTER INSERT OR UPDATE ON resource_status_period
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resource_policy_check_deferred();--> statement-breakpoint

CREATE OR REPLACE FUNCTION resource_retire_check_deferred() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_resource_bookings_valid(NEW.id, local_today());
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER resource_retire_deferred AFTER UPDATE OF retired_on ON resource
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resource_retire_check_deferred();--> statement-breakpoint

CREATE OR REPLACE FUNCTION group_member_check_deferred() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record; g uuid := coalesce(NEW.group_id, OLD.group_id);
BEGIN
  FOR r IN SELECT DISTINCT a.resource_id FROM exclusive_assignment a
            WHERE a.access_group_id = g AND a.cancelled_at IS NULL AND (a.valid_to IS NULL OR a.valid_to >= local_today())
            ORDER BY a.resource_id LOOP
    PERFORM assert_resource_bookings_valid(r.resource_id, local_today());
  END LOOP;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER access_group_member_deferred AFTER INSERT OR UPDATE OR DELETE ON access_group_member
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION group_member_check_deferred();--> statement-breakpoint

CREATE OR REPLACE FUNCTION office_calendar_check_deferred() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.is_open THEN PERFORM assert_day_bookings_valid(NEW.date); END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER office_calendar_deferred AFTER INSERT OR UPDATE ON office_calendar
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION office_calendar_check_deferred();--> statement-breakpoint

CREATE OR REPLACE FUNCTION employee_status_check_deferred() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('active', 'suspended') THEN PERFORM assert_employee_bookings_valid(NEW.id); END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER employee_status_deferred AFTER UPDATE OF status ON employee
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION employee_status_check_deferred();--> statement-breakpoint

-- Transferência verificada no commit: encerramento por transferência exige sucessora contígua não anulada;
-- anular a sucessora exige decisão explícita registrada na antecessora ou nova atribuição contígua.
CREATE OR REPLACE FUNCTION assignment_transfer_check_deferred() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pred exclusive_assignment%rowtype;
BEGIN
  IF NEW.end_reason = 'transferred' AND NEW.cancelled_at IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM exclusive_assignment s
                    WHERE s.transferred_from_id = NEW.id AND s.cancelled_at IS NULL AND s.valid_from = NEW.valid_to + 1) THEN
      RAISE EXCEPTION 'transfer_without_successor' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.cancelled_at IS NOT NULL AND NEW.transferred_from_id IS NOT NULL THEN
    SELECT * INTO pred FROM exclusive_assignment WHERE id = NEW.transferred_from_id;
    IF pred.end_reason = 'transferred' AND NOT EXISTS (
         SELECT 1 FROM exclusive_assignment s
          WHERE s.resource_id = NEW.resource_id AND s.id <> NEW.id AND s.cancelled_at IS NULL AND s.valid_from = NEW.valid_from) THEN
      RAISE EXCEPTION 'successor_cancel_needs_decision' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exclusive_assignment_transfer_deferred AFTER UPDATE ON exclusive_assignment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assignment_transfer_check_deferred();--> statement-breakpoint

-- Grants ao papel da aplicação (tabelas já cobertas pelos privilégios padrão de rh_owner).
GRANT EXECUTE ON FUNCTION period_range(date, date, date), office_setting_int(text, int), office_setting_text(text, text),
  assignment_state(exclusive_assignment, date), resource_unavailable_reason(uuid, date), office_open(date),
  is_eligible(uuid, uuid, date), is_bookable(uuid, uuid, date), booking_remains_valid(uuid, uuid, date), desk_class(uuid, date),
  booking_window_opens_at(date), booking_window_open(date, timestamptz), local_dates_of(tstzrange),
  transfer_assignment(uuid, uuid, date, text, text, uuid) TO rh_app;--> statement-breakpoint

-- Valores iniciais: grupo da diretoria e parâmetros configuráveis (PAR-01, PAR-35).
INSERT INTO access_group (code, name) VALUES ('diretoria', 'Diretoria') ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
INSERT INTO office_settings (key, value) VALUES
  ('booking_open_weekday', '4'::jsonb),
  ('booking_open_time', '"10:00"'::jsonb),
  ('booking_horizon_weeks', '4'::jsonb),
  ('exception_max_days', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;
