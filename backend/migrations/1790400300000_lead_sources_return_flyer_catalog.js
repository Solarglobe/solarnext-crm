/** Complete the historical 14-source catalogue without rewriting its applied migration. */
export const up = pgm => pgm.sql(`
  INSERT INTO lead_sources (organization_id,name,slug,sort_order)
  SELECT id,'Retour flyer','retour_flyer',7 FROM organizations o
  WHERE NOT EXISTS (SELECT 1 FROM lead_sources s WHERE s.organization_id=o.id AND s.slug='retour_flyer');

  UPDATE lead_sources s SET sort_order=c.sort_order
  FROM (VALUES ('retour_flyer',7),('salon_evenement',8),('recommandation',9),('client_existant',10),
    ('partenaire_apporteur',11),('appel_entrant',12),('email_entrant',13),('marketplace',14),('autre',15)) c(slug,sort_order)
  WHERE s.slug=c.slug AND s.sort_order<>c.sort_order;
`);

// Retain sources that may have acquired customer references after deployment.
export const down = pgm => pgm.sql('SELECT 1');
