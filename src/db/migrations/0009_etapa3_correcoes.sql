-- Correções da revisão independente da Etapa 3.
-- A oferta só trava a mesa ao nascer: quem cria a oferta já tomou a mesa no protocolo. Mudanças de estado da oferta
-- acompanham a retenção (cascata da expiração, suspensão, desativação, recusa) e não podem travar a mesa fora de ordem
-- (retenção antes da mesa), o que causava deadlock contra a reserva direta.
DROP TRIGGER IF EXISTS waitlist_offer_lock ON waitlist_offer;--> statement-breakpoint
CREATE TRIGGER waitlist_offer_lock BEFORE INSERT ON waitlist_offer FOR EACH ROW EXECUTE FUNCTION lock_resource_row();
