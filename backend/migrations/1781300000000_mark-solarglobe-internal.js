export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    UPDATE organizations
       SET onboarding_completed = true,
           onboarding_step_completed = ARRAY['company','mail','team','pipeline','lead']::text[],
           settings_json = jsonb_set(
             jsonb_set(
               jsonb_set(
                 COALESCE(settings_json, '{}'::jsonb) - 'signup',
                 '{plan}',
                 '{"code":"INTERNAL_FREE","label":"Solarglobe maison mere","billing":"FREE","limits":"UNLIMITED"}'::jsonb,
                 true
               ),
               '{billing}',
               '{"status":"FREE","limited":false,"trial":false}'::jsonb,
               true
             ),
             '{onboarding}',
             COALESCE(COALESCE(settings_json, '{}'::jsonb)->'onboarding', '{}'::jsonb)
               || '{"internal_exempt":true,"completed":true}'::jsonb,
             true
           )
     WHERE LOWER(COALESCE(name, '')) LIKE '%solarglobe%'
        OR id IN (
          SELECT organization_id
            FROM users
           WHERE LOWER(COALESCE(email, '')) LIKE '%@solarglobe.fr'
        );
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    UPDATE organizations
       SET settings_json = COALESCE(settings_json, '{}'::jsonb) - 'plan' - 'billing'
     WHERE COALESCE(settings_json, '{}'::jsonb)#>>'{onboarding,internal_exempt}' = 'true';
  `);
};
