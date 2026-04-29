/**
 * FullReport — Conteneur du PDF legacy (P13, P14 retirés — fin sur P12)
 * Chaque page reçoit viewModel.fullReport.pX
 */

import React from "react";
import PdfPage1 from "./PdfPage1";
import PdfPage2 from "./PdfPage2";
import PdfPage3 from "./PdfPage3";
import PdfPage3b from "./PdfPage3b";
import PdfPage4 from "./PdfPage4";
import PdfPage5 from "./PdfPage5";
import PdfPage6 from "./PdfPage6";
import PdfPage7 from "./PdfPage7";
import PdfPage7VirtualBattery from "./PdfPage7VirtualBattery";
import PdfPage8 from "./PdfPage8";
import PdfPage9 from "./PdfPage9";
import PdfPage10 from "./PdfPage10";
import PdfPage11 from "./PdfPage11";
import PdfPage12 from "./PdfPage12";
interface FullReportProps {
  viewModel: { fullReport?: Record<string, unknown>; [key: string]: unknown };
}

export default function FullReport({ viewModel }: FullReportProps) {
  const fr = (viewModel?.fullReport ?? {}) as Record<string, unknown>;

  return (
    <div className="full-report">
      <PdfPage1 data={fr.p1 as React.ComponentProps<typeof PdfPage1>["data"]} />
      <PdfPage2 data={fr.p2 as React.ComponentProps<typeof PdfPage2>["data"]} />
      <PdfPage3 data={fr.p3 as React.ComponentProps<typeof PdfPage3>["data"]} />
      <PdfPage3b data={fr.p3b as React.ComponentProps<typeof PdfPage3b>["data"]} />
      <PdfPage4 data={fr.p4 as React.ComponentProps<typeof PdfPage4>["data"]} />
      <PdfPage5 data={fr.p5 as React.ComponentProps<typeof PdfPage5>["data"]} />
      <PdfPage6 data={fr.p6 as React.ComponentProps<typeof PdfPage6>["data"]} />
      <PdfPage7 data={fr.p7 as React.ComponentProps<typeof PdfPage7>["data"]} />
      <PdfPage7VirtualBattery
        data={fr.p7_virtual_battery as React.ComponentProps<typeof PdfPage7VirtualBattery>["data"]}
        organization={viewModel.organization as React.ComponentProps<typeof PdfPage7VirtualBattery>["organization"]}
        viewModel={viewModel}
      />
      <PdfPage8 data={fr.p8 as React.ComponentProps<typeof PdfPage8>["data"]} />
      <PdfPage9 data={fr.p9 as React.ComponentProps<typeof PdfPage9>["data"]} />
      <PdfPage10 data={fr.p10 as React.ComponentProps<typeof PdfPage10>["data"]} />
      <PdfPage11 data={fr.p11 as React.ComponentProps<typeof PdfPage11>["data"]} />
      <PdfPage12 data={fr.p12 as React.ComponentProps<typeof PdfPage12>["data"]} />
    </div>
  );
}
