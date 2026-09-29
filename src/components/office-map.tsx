import Link from "next/link";
import type { ResourceState } from "@/modules/availability/service";
import type { PublishedMap } from "@/modules/workplace/service";

/*
 * Mapa SVG gerado do mapa operacional publicado. Cada recurso é um link focável com nome acessível que carrega
 * estado e ação; cor, ícone e texto andam juntos (nenhum estado depende só de cor). A lista ao lado é a alternativa completa.
 */

export const STATE_STYLE: Record<string, { fill: string; icon: string; text: string }> = {
  available: { fill: "var(--color-state-available)", icon: "✓", text: "Disponível" },
  reserved: { fill: "var(--color-state-reserved)", icon: "●", text: "Reservada" },
  mine: { fill: "var(--color-state-mine)", icon: "★", text: "Sua reserva" },
  offered: { fill: "var(--color-state-offered)", icon: "☆", text: "Oferecida a você" },
  exclusive: { fill: "var(--color-state-exclusive)", icon: "◆", text: "Uso exclusivo — Diretoria" },
  blocked: { fill: "var(--color-state-blocked)", icon: "■", text: "Bloqueada" },
  maintenance: { fill: "var(--color-state-maintenance)", icon: "⚠", text: "Em manutenção" },
  retired: { fill: "var(--color-state-blocked)", icon: "■", text: "Desativada" },
  office_closed: { fill: "var(--color-state-blocked)", icon: "■", text: "Escritório fechado" },
  window_closed: { fill: "var(--color-state-reserved)", icon: "○", text: "Fora da janela" },
  daily_limit: { fill: "var(--color-state-available)", icon: "✓", text: "Disponível" },
  inactive: { fill: "var(--color-state-blocked)", icon: "■", text: "Indisponível" },
};

export function Legend() {
  const items = ["available", "reserved", "mine", "offered", "exclusive", "blocked", "maintenance"] as const;
  return (
    <ul aria-label="Legenda do mapa" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map((k) => (
        <li key={k} className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm border border-border" style={{ background: STATE_STYLE[k].fill }} />
          <span aria-hidden="true">{STATE_STYLE[k].icon}</span>
          {STATE_STYLE[k].text}
        </li>
      ))}
    </ul>
  );
}

export function OfficeMap({ map, states, date, hrefFor }: { map: NonNullable<PublishedMap>; states: Map<string, ResourceState>; date: string; hrefFor: (code: string) => string }) {
  const W = 1000;
  const H = 700;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm text-text-muted">
        {map.plan.name}. Estados calculados no servidor para {date.split("-").reverse().join("/")}. Use Tab para percorrer as mesas.
      </figcaption>
      <div className="max-w-full overflow-auto rounded-md border border-border bg-surface-muted" role="region" aria-label="Mapa do escritório" tabIndex={0}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[640px]" role="group" aria-label={`Mapa com ${map.placements.length} recursos`}>
          <rect x="0" y="0" width={W} height={H} fill="var(--color-surface)" />
          {map.placements.map((p) => {
            const st = states.get(p.resourceId);
            const code = st?.availability.code ?? "inactive";
            // Oferta da fila ainda não aceita tem estilo próprio: não é reserva (DEC-40).
            const style = st?.availability.offerPending ? STATE_STYLE.offered : (STATE_STYLE[code] ?? STATE_STYLE.inactive);
            const label = st ? `${p.code}: ${st.availability.label}${st.availability.canBook ? ", reservar" : ""}` : `${p.code}: sem estado`;
            const x = p.x * W;
            const y = p.y * H;
            const w = Math.max(p.w * W, 14);
            const h = Math.max(p.h * H, 12);
            return (
              <Link key={p.resourceId} href={hrefFor(p.code)} aria-label={label} className="focus:outline-none">
                <g>
                  <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx="2" fill={style.fill} stroke="var(--color-border-strong)" strokeWidth="1" className="[a:focus-visible_&]:stroke-[3] [a:focus-visible_&]:stroke-primary" />
                  <text x={x} y={y + 3} textAnchor="middle" fontSize="8" fill="var(--color-text)" aria-hidden="true">
                    {p.type === "desk" ? style.icon : p.code}
                  </text>
                </g>
              </Link>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
