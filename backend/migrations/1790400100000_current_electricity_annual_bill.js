/** Customer's total bill over twelve months, including the electricity subscription. */
export const shorthands = undefined;

export const up = (pgm) => {
  for (const table of ["leads", "lead_meters"]) {
    pgm.addColumns(table, {
      electricity_annual_bill_ttc: {
        type: "numeric(12,2)",
        notNull: false,
        check: "electricity_annual_bill_ttc >= 0 AND electricity_annual_bill_ttc < 10000000000",
      },
    }, { ifNotExists: true });
  }
};

export const down = (pgm) => {
  for (const table of ["lead_meters", "leads"]) {
    pgm.dropColumns(table, ["electricity_annual_bill_ttc"], { ifExists: true });
  }
};
