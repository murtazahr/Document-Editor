"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, StateEffect, StateField, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, Decoration, type DecorationSet, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { bracketMatching, StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";

export type HighlightRange = { from: number; to: number; cls: string };

export type LatexEditorHandle = {
  /** Scroll to and briefly flash a source range. */
  reveal: (from: number, to?: number) => void;
  getSelection: () => { from: number; to: number; text: string } | null;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  highlights?: HighlightRange[];
  onSave?: () => void;
  readOnly?: boolean;
};

const setHighlights = StateEffect.define<HighlightRange[]>();
const setFlash = StateEffect.define<{ from: number; to: number } | null>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        const ranges = e.value
          .filter((r) => r.to > r.from && r.from >= 0 && r.to <= tr.newDoc.length)
          .sort((a, b) => a.from - b.from || a.to - b.to)
          .map((r) => Decoration.mark({ class: r.cls }).range(r.from, r.to));
        deco = Decoration.set(ranges, true);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlash)) {
        deco = e.value && e.value.to > e.value.from && e.value.to <= tr.newDoc.length ? Decoration.set([Decoration.mark({ class: "cm-flash" }).range(e.value.from, e.value.to)]) : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const LatexEditor = forwardRef<LatexEditorHandle, Props>(function LatexEditor({ value, onChange, highlights, onSave, readOnly }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const readOnlyComp = useRef(new Compartment());
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), history(), bracketMatching(), closeBrackets(), highlightSelectionMatches(),
      StreamLanguage.define(stex), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.lineWrapping, highlightField, flashField,
      placeholder("Start writing LaTeX…"),
      keymap.of([
        { key: "Mod-s", run: () => { onSaveRef.current?.(); return true; } },
        ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab,
      ]),
      EditorView.updateListener.of((u) => { if (u.docChanged) onChangeRef.current(u.state.doc.toString()); }),
      readOnlyComp.current.of(EditorState.readOnly.of(!!readOnly)),
    ];
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external value changes (file switch, baseline restore)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyComp.current.reconfigure(EditorState.readOnly.of(!!readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    view.current?.dispatch({ effects: setHighlights.of(highlights ?? []) });
  }, [highlights]);

  useImperativeHandle(ref, () => ({
    reveal(from, to) {
      const v = view.current;
      if (!v) return;
      const len = v.state.doc.length;
      const f = Math.max(0, Math.min(from, len));
      const t = Math.max(f, Math.min(to ?? from, len));
      v.dispatch({ selection: { anchor: f }, effects: [EditorView.scrollIntoView(f, { y: "center" }), setFlash.of({ from: f, to: t })] });
      setTimeout(() => view.current?.dispatch({ effects: setFlash.of(null) }), 1600);
    },
    getSelection() {
      const v = view.current;
      if (!v) return null;
      const r = v.state.selection.main;
      if (r.empty) return null;
      return { from: r.from, to: r.to, text: v.state.sliceDoc(r.from, r.to) };
    },
    focus() { view.current?.focus(); },
  }));

  return <div ref={host} className="h-full min-h-0 w-full overflow-hidden" />;
});

export default LatexEditor;
