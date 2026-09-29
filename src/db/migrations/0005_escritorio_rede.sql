-- Rede independente da disciplina do código (DEC-14, DIR-036): o papel da aplicação não apaga registros do escritório
-- e a identidade de uma atribuição (mesa, modalidade, titular ou grupo) não muda depois de criada; transferência só pela função.

REVOKE DELETE ON exclusive_assignment, access_exception, resource_status_period, desk_booking, space_booking, access_group_member, office_calendar, floor_plan_version FROM rh_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION exclusive_assignment_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resource_id <> OLD.resource_id OR NEW.mode <> OLD.mode
     OR NEW.holder_employee_id IS DISTINCT FROM OLD.holder_employee_id
     OR NEW.access_group_id IS DISTINCT FROM OLD.access_group_id
     OR NEW.transferred_from_id IS DISTINCT FROM OLD.transferred_from_id THEN
    RAISE EXCEPTION 'assignment_identity_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER exclusive_assignment_identity BEFORE UPDATE ON exclusive_assignment FOR EACH ROW EXECUTE FUNCTION exclusive_assignment_identity();--> statement-breakpoint

-- Exceção: mesa, atribuição, tipo e beneficiário também não mudam; revogar é a única alteração prevista.
CREATE OR REPLACE FUNCTION access_exception_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resource_id <> OLD.resource_id OR NEW.assignment_id <> OLD.assignment_id OR NEW.kind <> OLD.kind
     OR NEW.beneficiary_employee_id IS DISTINCT FROM OLD.beneficiary_employee_id
     OR NEW.starts_on <> OLD.starts_on OR NEW.ends_on <> OLD.ends_on THEN
    RAISE EXCEPTION 'exception_identity_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER access_exception_identity BEFORE UPDATE ON access_exception FOR EACH ROW EXECUTE FUNCTION access_exception_identity();
