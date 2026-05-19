/**
 * Remove the legacy onboarding pipeline draft.
 *
 * The real CRM pipeline is stored in pipeline_stages and seeded independently.
 * Keeping settings_json.onboarding.pipeline made first-run setup look like it
 * could configure the business pipeline, which is not the intended workflow.
 */
export const up = (pgm) => {
  pgm.sql(`
    UPDATE organizations
    SET settings_json = jsonb_set(
      settings_json,
      '{onboarding}',
      COALESCE(settings_json->'onboarding', '{}'::jsonb) - 'pipeline',
      true
    )
    WHERE settings_json ? 'onboarding'
      AND COALESCE(settings_json->'onboarding', '{}'::jsonb) ? 'pipeline';

    UPDATE organizations
    SET onboarding_step_completed = array_remove(onboarding_step_completed, 'pipeline')
    WHERE onboarding_step_completed @> ARRAY['pipeline']::text[];
  `);
};

export const down = () => {
  // No-op: the removed onboarding draft was not the canonical CRM pipeline.
};
