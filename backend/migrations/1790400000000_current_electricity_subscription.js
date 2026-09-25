/** Current supplier subscription from the customer's bill. Unknown stays null. */
export const shorthands = undefined;

export const up = (pgm) => {
  for (const table of ["leads", "lead_meters"]) {
    pgm.addColumns(table, {
      electricity_subscription_ttc_month: {
        type: "numeric(10,2)",
        notNull: false,
        check: "electricity_subscription_ttc_month >= 0 AND electricity_subscription_ttc_month < 100000000",
      },
    });
  }
};

export const down = (pgm) => {
  for (const table of ["lead_meters", "leads"]) {
    pgm.dropColumns(table, ["electricity_subscription_ttc_month"]);
  }
};
