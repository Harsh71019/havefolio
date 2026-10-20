/** Called after a form has committed any disclosure needed to reveal the invalid control. */
export function focusValidationControl(id: string): void {
  const control = document.getElementById(id);
  if (!control) return;
  control.focus({ preventScroll: true });
  control.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'center',
  });
}
