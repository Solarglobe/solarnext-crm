import React, { useCallback, useEffect, useRef, useState } from "react";
import { ModalShell } from "../../components/ui/ModalShell";
import { Button } from "../../components/ui/Button";
import {
  QUOTE_SIGNATURE_PAD_LOGICAL_H,
  QUOTE_SIGNATURE_PAD_LOGICAL_W,
  quoteSignaturePadLogicalPoint,
} from "./quoteSignaturePadCoords";
import { SIGNATURE_READ_ACCEPTANCE_LABEL_FR, type SignaturePadConfirmPayload } from "./signatureReadAcceptance";
import "./quote-signature-pad.css";

export interface QuoteSignaturePadModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  onConfirm: (payload: SignaturePadConfirmPayload) => void;
}

export function QuoteSignaturePadModal({ open, onClose, title, onConfirm }: QuoteSignaturePadModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [readAccepted, setReadAccepted] = useState(false);

  const layoutCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2.5, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    canvas.width = Math.max(1, Math.floor(QUOTE_SIGNATURE_PAD_LOGICAL_W * dpr));
    canvas.height = Math.max(1, Math.floor(QUOTE_SIGNATURE_PAD_LOGICAL_H * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.fillRect(0, 0, QUOTE_SIGNATURE_PAD_LOGICAL_W, QUOTE_SIGNATURE_PAD_LOGICAL_H);
    ctx.strokeStyle = "#16131c";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setHasInk(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setReadAccepted(false);
    let id0 = 0;
    let id1 = 0;
    id0 = requestAnimationFrame(() => {
      id1 = requestAnimationFrame(() => {
        layoutCanvas();
      });
    });
    return () => {
      cancelAnimationFrame(id0);
      cancelAnimationFrame(id1);
    };
  }, [open, layoutCanvas]);

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* navigateurs anciens */
    }
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = quoteSignaturePadLogicalPoint(canvas, e.clientX, e.clientY);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = quoteSignaturePadLogicalPoint(canvas, e.clientX, e.clientY);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  };

  const endDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }
    }
  };

  const clear = () => {
    layoutCanvas();
  };

  const confirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk || !readAccepted) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      onConfirm({
        dataUrl,
        accepted: true,
        acceptedLabel: SIGNATURE_READ_ACCEPTANCE_LABEL_FR,
      });
      onClose();
    } catch {
      /* */
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            Effacer
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={!hasInk || !readAccepted} onClick={confirm}>
            Valider la signature
          </Button>
        </div>
      }
    >
      <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.85 }}>
        Signez dans le cadre agrandi ci-dessous (souris, stylet ou doigt). Le tracé suit le pointeur : la signature
        s&apos;affichera ensuite dans le petit cadre du document.
      </p>
      <div className="quote-signature-pad-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="quote-signature-pad-canvas"
          onPointerDown={startDraw}
          onPointerMove={moveDraw}
          onPointerUp={endDraw}
          onPointerCancel={endDraw}
        />
      </div>
      <label className="quote-signature-read-accept">
        <input
          type="checkbox"
          checked={readAccepted}
          onChange={(e) => setReadAccepted(e.target.checked)}
        />
        <span>{SIGNATURE_READ_ACCEPTANCE_LABEL_FR}</span>
      </label>
    </ModalShell>
  );
}
