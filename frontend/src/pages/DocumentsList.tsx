import React from "react";
import { Card } from "../components/ui/Card";

export default function DocumentsList() {
  return (
    <Card style={{ padding: "var(--spacing-24)" }}>
      <h1 className="sg-title">
        Documents
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)" }}>
        Documents — à migrer
      </p>
    </Card>
  );
}
