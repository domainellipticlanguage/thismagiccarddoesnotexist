import { useEffect, useState } from "react";
import type { BugReport } from "../types/card";
import { fetchBugReport, reportBug } from "../api/client";

/** 🪲 button for reporting a rendering bug on a card. Neutral when clean,
 *  amber once a report exists. Clicking opens a popover that shows the existing
 *  report (if any) and lets the user submit/overwrite it. Open to anyone.
 *
 *  Bug reports are a separate mutable resource (the card stays immutable), so
 *  this is self-contained: it reads its own state on mount and writes on submit,
 *  with no bug data threaded through the card pages. The read is async and never
 *  blocks page render — the button just starts neutral and flips to amber when
 *  it resolves. Key by cardId so it re-inits when the card changes. */
export function BugReportButton({ cardId }: { cardId: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<BugReport | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reported = !!report;

  // Load the current report on mount (non-blocking). Only seed the textarea if
  // it's still empty, so we never clobber text the user is mid-edit.
  useEffect(() => {
    let active = true;
    fetchBugReport(cardId)
      .then((r) => {
        if (!active) return;
        setReport(r);
        setText((cur) => cur || r?.text || "");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [cardId]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const saved = await reportBug(cardId, text.trim());
      setReport(saved);
      setOpen(false);
    } catch (err: any) {
      setError(err.message || "Failed to report bug");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={reported ? "Bug reported — click to view or update" : "Report a rendering bug"}
        className={`px-3 py-2 rounded-lg text-sm transition-colors inline-flex items-center gap-1.5 ${
          reported
            ? "bg-amber-900/50 text-amber-300 hover:bg-amber-900/80"
            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        <span aria-hidden>🪲</span>
        {reported ? "Bug reported" : "Report bug"}
      </button>

      {open && (
        <>
          {/* Click-outside backdrop. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-72 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-3 space-y-2">
            <p className="text-xs uppercase tracking-wider text-neutral-500">
              {reported ? `Reported ${new Date(report!.reportedAt).toLocaleString()}` : "Report a rendering bug"}
            </p>
            <textarea
              className="input w-full resize-none text-sm"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What looks wrong? (optional)"
              disabled={saving}
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={saving} className="px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200">
                Cancel
              </button>
              <button type="button" onClick={submit} disabled={saving} className="px-3 py-1.5 bg-gold-500 text-neutral-950 font-semibold rounded-md text-sm hover:bg-gold-400 disabled:opacity-50">
                {saving ? "Saving..." : reported ? "Update" : "Report"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
