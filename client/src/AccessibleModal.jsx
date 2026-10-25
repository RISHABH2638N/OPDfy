import React, { useLayoutEffect, useRef } from "react";
import "./accessible-modal.css";

/** Native modal top layer supplies background inertness and focus containment. */
export default function AccessibleModal({ children, onDismiss, className, labelledBy, dismissOnBackdrop = false }) {
  const dialogRef = useRef(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      // Native close normally restores focus; also cover React unmount/navigation.
      if (trigger?.isConnected && !document.querySelector('dialog[open]')) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className={`accessible-modal ${className}`} aria-labelledby={labelledBy}
    onBlur={event => {
      const dialog = event.currentTarget;
      // Viewport/layout changes can blur a native dialog control. Keep an
      // active modal's focus inside; never steal focus after close/unmount.
      queueMicrotask(() => {
        if (!dialog.isConnected || !dialog.matches(":modal") || dialog.contains(document.activeElement)) return;
        const control = [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')]
          .find(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
        (control || dialog).focus({ preventScroll: true });
      });
    }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')]
        .filter(el => el.tabIndex >= 0 && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { event.preventDefault(); dismissRef.current?.(); }}
    onClick={event => { if (dismissOnBackdrop && event.target === event.currentTarget) dismissRef.current?.(); }}>
    {children}
  </dialog>;
}
