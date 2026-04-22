import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Color } from "@tiptap/extension-color";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Underline } from "@tiptap/extension-underline";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TextStyle, FontSize, LineHeight } from "@tiptap/extension-text-style";
import { TextAlign } from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { sanitizeMailHtmlComposer } from "./mailHtmlSanitize";
import {
  colorToHexForInput,
  COLOR_SWATCHES,
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  FONT_SIZE_PRESETS,
  clampFontSizePxInt,
  isPresetFontSizeValue,
  parseFontSizePx,
  IMAGE_WIDTH_PRESETS,
  LINE_HEIGHT_PRESETS,
  MAIL_SIG_PRO_TEMPLATE_HTML,
} from "./mailHtmlEditorConstants";
import { MAIL_HTML_MAX_UTF8_BYTES, MAIL_IMAGE_FILE_MAX_BYTES, utf8ByteLength } from "./mailHtmlEditorLimits";
import "./mail-html-editor.css";

export type MailHtmlEditorHandle = {
  getHTML: () => string;
  setHTML: (html: string, options?: { silent?: boolean }) => void;
  focus: () => void;
};

export type MailHtmlEditorVariant = "signature" | "template" | "composer";

export type MailHtmlEditorProps = {
  variant: MailHtmlEditorVariant;
  /** Quand cette clé change, le contenu est remplacé par initialHtml (hydratation composer, etc.). */
  docKey: string | number;
  initialHtml: string;
  placeholder?: string;
  editable?: boolean;
  onChange?: (html: string) => void;
  className?: string;
  /** Barre d’outils secondaire (ex. ligne « Importer »). */
  extraToolbar?: React.ReactNode;
  onBlur?: () => void;
};

function ToolbarButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`mail-html-editor__tool${active ? " mail-html-editor__tool--active" : ""}`}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const MailHtmlEditor = forwardRef<MailHtmlEditorHandle, MailHtmlEditorProps>(function MailHtmlEditor(
  { variant, docKey, initialHtml, placeholder = "…", editable = true, onChange, className = "", extraToolbar, onBlur },
  ref
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const lastDocKeyRef = useRef<string | number | undefined>(undefined);
  const [oversizeBytes, setOversizeBytes] = useState<number | null>(null);
  const [imageAttrs, setImageAttrs] = useState<{ width?: string | null; src?: string | null }>({});

  const showImport = variant === "signature";
  const showCodeToggle = variant === "signature" || variant === "template";
  const showProTemplate = variant === "signature";
  const surfaceClass =
    variant === "composer" ? "mail-html-editor__surface mail-html-editor__surface--composer" : "mail-html-editor__surface";

  const safeColorSwatches = COLOR_SWATCHES ?? [];

  const emitSize = useCallback((html: string) => {
    const n = utf8ByteLength(html);
    setOversizeBytes(n > MAIL_HTML_MAX_UTF8_BYTES ? n : null);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        blockquote: {},
        horizontalRule: {},
        link: false,
        bulletList: {},
        orderedList: {},
        underline: false,
      }),
      TextStyle,
      FontSize,
      LineHeight,
      Color,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      TextAlign.configure({
        types: ["paragraph", "heading", "blockquote", "tableCell", "tableHeader"],
        alignments: ["left", "center", "right"],
        defaultAlignment: null,
      }),
      TableKit.configure({
        table: { resizable: true },
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: { class: "mail-html-img" },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialHtml || "<p></p>",
    editable,
    editorProps: {
      attributes: {
        class: "mail-html-prose",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      emitSize(html);
      onChange?.(html);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      getHTML: () => editor?.getHTML() ?? "",
      setHTML: (html: string, opts?: { silent?: boolean }) => {
        const h = html?.trim() ? html : "<p></p>";
        editor?.chain().focus().setContent(h, { emitUpdate: !opts?.silent }).run();
      },
      focus: () => {
        editor?.chain().focus().run();
      },
    }),
    [editor]
  );

  useEffect(() => {
    if (!editor) return;
    if (lastDocKeyRef.current === docKey) return;
    lastDocKeyRef.current = docKey;
    const h = initialHtml?.trim() ? initialHtml : "<p></p>";
    editor.commands.setContent(h, { emitUpdate: false });
    emitSize(h);
    setHtmlMode(false);
  }, [docKey, initialHtml, editor, emitSize]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || !onBlur) return;
    const fn = () => onBlur();
    editor.on("blur", fn);
    return () => {
      editor.off("blur", fn);
    };
  }, [editor, onBlur]);

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      if (editor.isActive("image")) {
        setImageAttrs(editor.getAttributes("image"));
      } else {
        setImageAttrs({});
      }
    };
    editor.on("selectionUpdate", sync);
    editor.on("transaction", sync);
    sync();
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("transaction", sync);
    };
  }, [editor]);

  const applySanitizedHtml = useCallback(
    (raw: string) => {
      const clean = sanitizeMailHtmlComposer(raw || "");
      editor?.chain().focus().setContent(clean || "<p></p>", { emitUpdate: true }).run();
      setHtmlMode(false);
      setPasteOpen(false);
    },
    [editor]
  );

  const onPickColor = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      editor?.chain().focus().setColor(v).run();
    },
    [editor]
  );

  const applySwatchColor = useCallback(
    (hex: string) => {
      editor?.chain().focus().setColor(hex).run();
    },
    [editor]
  );

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = window.prompt("URL du lien (https://…)", "https://");
    if (prev == null) return;
    const url = prev.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const addImageFromUrl = useCallback(() => {
    if (!editor) return;
    const u = window.prompt("URL de l’image (https://…)", "https://");
    if (u == null || !u.trim()) return;
    editor.chain().focus().setImage({ src: u.trim() }).run();
  }, [editor]);

  const onPickImageFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f || !f.type.startsWith("image/")) return;
      if (f.size > MAIL_IMAGE_FILE_MAX_BYTES) {
        window.alert(`Image trop volumineuse (max. ${Math.round(MAIL_IMAGE_FILE_MAX_BYTES / 1024)} Ko).`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl) return;
        editor?.chain().focus().setImage({ src: dataUrl, alt: f.name }).run();
      };
      reader.readAsDataURL(f);
    },
    [editor]
  );

  const setImageWidth = useCallback(
    (width: string) => {
      if (!editor?.isActive("image")) return;
      editor.chain().focus().updateAttributes("image", { width }).run();
    },
    [editor]
  );

  const clearFormatting = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().unsetAllMarks().clearNodes().run();
  }, [editor]);

  const insertProSignature = useCallback(() => {
    const clean = sanitizeMailHtmlComposer(MAIL_SIG_PRO_TEMPLATE_HTML);
    editor?.chain().focus().setContent(clean, { emitUpdate: true }).run();
  }, [editor]);

  const applyLineHeightPreset = useCallback(
    (lh: string) => {
      if (!editor) return;
      const { empty } = editor.state.selection;
      const chain = editor.chain().focus();
      if (empty) chain.selectAll();
      chain.setLineHeight(lh).run();
    },
    [editor]
  );

  useEffect(() => {
    if (!editor) return;
    emitSize(editor.getHTML());
  }, [editor, emitSize]);

  if (!editor) {
    return <div className={`mail-html-editor ${className}`} aria-busy="true" />;
  }

  const textStyleAttrs = editor.getAttributes("textStyle") as { fontSize?: string | null; color?: string | null };
  const currentFontSize = textStyleAttrs.fontSize ?? "";
  const fontSizePxParsed = parseFontSizePx(currentFontSize);
  const fontSizeSelectValue = isPresetFontSizeValue(currentFontSize) ? currentFontSize : "";
  /** Remonte le champ manuel quand la taille appliquée change (liste ou éditeur). */
  const fontSizeManualKey = currentFontSize || "none";

  return (
    <div className={`mail-html-editor ${className}`}>
      {oversizeBytes != null && (
        <div className="mail-html-editor__warn" role="alert">
          Contenu trop volumineux ({Math.round(oversizeBytes / 1024)} Ko). Limite recommandée :{" "}
          {MAIL_HTML_MAX_UTF8_BYTES / 1024} Ko — raccourcissez le HTML ou réduisez les images.
        </div>
      )}

      {showCodeToggle && (
        <div className="mail-html-editor__mode-toggle" role="group" aria-label="Mode d’édition">
          <button
            type="button"
            className={`mail-html-editor__mode-btn${!htmlMode ? " mail-html-editor__mode-btn--active" : ""}`}
            onClick={() => {
              if (htmlMode) setHtmlMode(false);
            }}
          >
            Visuel
          </button>
          <button
            type="button"
            className={`mail-html-editor__mode-btn${htmlMode ? " mail-html-editor__mode-btn--active" : ""}`}
            onClick={() => {
              if (!htmlMode && editor) {
                setCodeDraft(editor.getHTML());
                setHtmlMode(true);
              }
            }}
          >
            HTML
          </button>
        </div>
      )}

      {!htmlMode && (
        <>
          <div className="mail-html-editor__toolbar" role="toolbar" aria-label="Mise en forme">
            <div className="mail-html-editor__toolbar-group">
              <ToolbarButton
                title="Gras"
                active={editor.isActive("bold")}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <strong>B</strong>
              </ToolbarButton>
              <ToolbarButton
                title="Italique"
                active={editor.isActive("italic")}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <em>I</em>
              </ToolbarButton>
              <ToolbarButton
                title="Souligné"
                active={editor.isActive("underline")}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              >
                <u>S</u>
              </ToolbarButton>
            </div>
            <span className="mail-html-editor__toolbar-sep" aria-hidden />
            <div className="mail-html-editor__toolbar-group mail-html-editor__toolbar-group--fontsize">
              <label className="mail-html-editor__select-label">
                <span className="mail-html-editor__sr-only">Taille du texte</span>
                <select
                  className="mail-html-editor__select mail-html-editor__select--fontsize"
                  title="Taille du texte (8–30 px)"
                  value={fontSizeSelectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) editor.chain().focus().unsetFontSize().run();
                    else editor.chain().focus().setFontSize(v).run();
                  }}
                >
                  <option value="">Taille…</option>
                  {FONT_SIZE_PRESETS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mail-html-editor__fontsize-manual-label" title="Manuel 8–30 px — Entrée ou clic hors champ pour appliquer">
                <input
                  key={fontSizeManualKey}
                  type="number"
                  min={FONT_SIZE_MIN_PX}
                  max={FONT_SIZE_MAX_PX}
                  step={1}
                  className="mail-html-editor__fontsize-num"
                  aria-label="Taille manuelle en pixels (8 à 30)"
                  placeholder={`${FONT_SIZE_MIN_PX}–${FONT_SIZE_MAX_PX}`}
                  defaultValue={fontSizePxParsed != null ? String(Math.round(fontSizePxParsed)) : ""}
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") return;
                    const n = clampFontSizePxInt(Number.parseInt(raw, 10));
                    if (!Number.isFinite(n)) return;
                    editor.chain().focus().setFontSize(`${n}px`).run();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
                <span className="mail-html-editor__fontsize-suffix" aria-hidden>
                  px
                </span>
              </label>
            </div>
            <span className="mail-html-editor__toolbar-sep" aria-hidden />
            <div className="mail-html-editor__toolbar-group mail-html-editor__color-wrap" title="Couleur du texte">
              <label className="mail-html-editor__color-label">
                <span className="mail-html-editor__color-label-text">Couleur</span>
                <input
                  type="color"
                  className="mail-html-editor__color-palette"
                  value={colorToHexForInput(textStyleAttrs.color)}
                  aria-label="Palette de couleur du texte"
                  onChange={onPickColor}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </label>
              {safeColorSwatches.length > 0 ? (
                <div className="mail-html-editor__color-swatches" role="group" aria-label="Couleurs rapides">
                  {safeColorSwatches.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      className="mail-html-editor__color-swatch"
                      style={{ backgroundColor: hex }}
                      title={hex}
                      aria-label={`Couleur ${hex}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applySwatchColor(hex)}
                    />
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                className="mail-html-editor__color-reset"
                title="Couleur par défaut (héritée)"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().unsetColor().run()}
              >
                Défaut
              </button>
            </div>
            <span className="mail-html-editor__toolbar-sep" aria-hidden />
            <div className="mail-html-editor__toolbar-group">
              <ToolbarButton
                title="Aligner à gauche"
                active={editor.isActive({ textAlign: "left" })}
                onClick={() => editor.chain().focus().setTextAlign("left").run()}
              >
                <span className="mail-html-editor__align-btn">L</span>
              </ToolbarButton>
              <ToolbarButton
                title="Centrer"
                active={editor.isActive({ textAlign: "center" })}
                onClick={() => editor.chain().focus().setTextAlign("center").run()}
              >
                <span className="mail-html-editor__align-btn">C</span>
              </ToolbarButton>
              <ToolbarButton
                title="Aligner à droite"
                active={editor.isActive({ textAlign: "right" })}
                onClick={() => editor.chain().focus().setTextAlign("right").run()}
              >
                <span className="mail-html-editor__align-btn">R</span>
              </ToolbarButton>
            </div>
            <span className="mail-html-editor__toolbar-sep" aria-hidden />
            <div className="mail-html-editor__toolbar-group mail-html-editor__toolbar-group--select">
              <label className="mail-html-editor__select-label">
                <span className="mail-html-editor__sr-only">Interligne</span>
                <select
                  className="mail-html-editor__select"
                  title="Interligne (sélection ou tout le texte si rien n’est sélectionné)"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) applyLineHeightPreset(v);
                    e.target.selectedIndex = 0;
                  }}
                >
                  <option value="">Interligne…</option>
                  {LINE_HEIGHT_PRESETS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <span className="mail-html-editor__toolbar-sep" aria-hidden />
            <div className="mail-html-editor__toolbar-group">
              <ToolbarButton title="Lien" onClick={setLink}>
                🔗
              </ToolbarButton>
              <ToolbarButton
                title="Liste à puces"
                active={editor.isActive("bulletList")}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                •
              </ToolbarButton>
              <div className="mail-html-editor__image-menu">
                <ToolbarButton title="Image (URL ou fichier)" onClick={addImageFromUrl}>
                  🖼 URL
                </ToolbarButton>
                <button
                  type="button"
                  className="mail-html-editor__tool mail-html-editor__tool--import"
                  title="Insérer une image depuis votre ordinateur"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => imageFileInputRef.current?.click()}
                >
                  Fichier
                </button>
              </div>
            </div>
            {editor.isActive("image") && (
              <>
                <span className="mail-html-editor__toolbar-sep" aria-hidden />
                <div className="mail-html-editor__toolbar-group mail-html-editor__toolbar-group--select">
                  <label className="mail-html-editor__select-label">
                    <span className="mail-html-editor__sr-only">Largeur image</span>
                    <select
                      className="mail-html-editor__select"
                      title="Largeur de l’image sélectionnée"
                      value={imageAttrs.width != null && imageAttrs.width !== "" ? String(imageAttrs.width) : ""}
                      onChange={(e) => setImageWidth(e.target.value)}
                    >
                      <option value="">Largeur…</option>
                      {IMAGE_WIDTH_PRESETS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}
            <span className="mail-html-editor__toolbar-sep" aria-hidden />
            <div className="mail-html-editor__toolbar-group">
              <ToolbarButton
                title="Insérer un tableau 2×2"
                onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()}
              >
                <span className="mail-html-editor__table-btn">▦</span>
              </ToolbarButton>
            </div>
            <span className="mail-html-editor__toolbar-sep" aria-hidden />
            <div className="mail-html-editor__toolbar-group">
              <ToolbarButton title="Effacer le formatage" onClick={clearFormatting}>
                Tx
              </ToolbarButton>
            </div>
            {showProTemplate && (
              <>
                <span className="mail-html-editor__toolbar-sep" aria-hidden />
                <div className="mail-html-editor__toolbar-group">
                  <button
                    type="button"
                    className="mail-html-editor__tool mail-html-editor__tool--import"
                    title="Insérer un modèle de signature entreprise (logo + coordonnées)"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={insertProSignature}
                  >
                    Signature pro
                  </button>
                </div>
              </>
            )}
            {showImport && (
              <>
                <span className="mail-html-editor__toolbar-sep" aria-hidden />
                <div className="mail-html-editor__toolbar-group">
                  <button
                    type="button"
                    className="mail-html-editor__tool mail-html-editor__tool--import"
                    title="Importer un fichier HTML"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Importer…
                  </button>
                  <button
                    type="button"
                    className="mail-html-editor__tool mail-html-editor__tool--import"
                    title="Coller du HTML brut"
                    onClick={() => {
                      setPasteDraft(editor.getHTML());
                      setPasteOpen(true);
                    }}
                  >
                    Coller HTML
                  </button>
                </div>
              </>
            )}
            {extraToolbar}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm,text/html"
            className="mail-html-editor__import-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => {
                const text = typeof reader.result === "string" ? reader.result : "";
                applySanitizedHtml(text);
              };
              reader.readAsText(f);
            }}
          />
          <input
            ref={imageFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
            className="mail-html-editor__import-hidden"
            onChange={onPickImageFile}
          />
        </>
      )}

      {htmlMode ? (
        <textarea
          className="mail-html-editor__code"
          value={codeDraft}
          onChange={(e) => setCodeDraft(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div className={surfaceClass}>
          <EditorContent editor={editor} />
        </div>
      )}

      {htmlMode && (
        <div className="mail-html-editor__modal-actions" style={{ justifyContent: "flex-start" }}>
          <button
            type="button"
            className="sg-btn sg-btn-primary"
            onClick={() => applySanitizedHtml(codeDraft)}
          >
            Appliquer le HTML
          </button>
          <button type="button" className="sg-btn sg-btn-ghost" onClick={() => setHtmlMode(false)}>
            Annuler
          </button>
        </div>
      )}

      {pasteOpen && (
        <div
          className="mail-html-editor__modal-backdrop"
          role="dialog"
          aria-modal
          aria-labelledby="mail-html-paste-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPasteOpen(false);
          }}
        >
          <div className="mail-html-editor__modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3 id="mail-html-paste-title">Coller votre signature (HTML)</h3>
            <textarea value={pasteDraft} onChange={(e) => setPasteDraft(e.target.value)} spellCheck={false} />
            <div className="mail-html-editor__modal-actions">
              <button type="button" className="sg-btn sg-btn-ghost" onClick={() => setPasteOpen(false)}>
                Annuler
              </button>
              <button type="button" className="sg-btn sg-btn-primary" onClick={() => applySanitizedHtml(pasteDraft)}>
                Importer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
