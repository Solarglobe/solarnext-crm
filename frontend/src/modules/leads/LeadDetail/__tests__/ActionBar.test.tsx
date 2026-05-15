import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ActionBar from "../ActionBar";

describe("LeadDetail ActionBar", () => {
  it("keeps lead study actions clickable when available", () => {
    const onStudyClick = vi.fn();
    const onCreateStudy = vi.fn();
    const onRunCalc = vi.fn();

    render(
      <ActionBar
        isLead
        showStudyButtons
        onStudyClick={onStudyClick}
        onCreateStudy={onCreateStudy}
        onRunCalc={onRunCalc}
        studiesCount={1}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Voir les études" }));
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle étude" }));
    fireEvent.click(screen.getByRole("button", { name: "Lancer le calcul" }));

    expect(onStudyClick).toHaveBeenCalledTimes(1);
    expect(onCreateStudy).toHaveBeenCalledTimes(1);
    expect(onRunCalc).toHaveBeenCalledTimes(1);
  });

  it("disables calculation until at least one study exists", () => {
    const onRunCalc = vi.fn();

    render(<ActionBar isLead showStudyButtons onRunCalc={onRunCalc} studiesCount={0} />);

    const runCalc = screen.getByRole("button", { name: "Lancer le calcul" });
    expect(runCalc).toBeDisabled();

    fireEvent.click(runCalc);

    expect(onRunCalc).not.toHaveBeenCalled();
  });
});
