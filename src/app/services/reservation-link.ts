export function reservationLink(
  document: Document,
  action: string,
): { id: string; token: string } | null {
  const window = document.defaultView;
  if (!window?.location.hash.startsWith(`#${action}?`)) return null;
  const params = new URLSearchParams(window.location.hash.split('?')[1]);
  const id = params.get('id') || '';
  const token = params.get('token') || '';
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}#${action}`,
  );
  return id && /^[a-f0-9]{64}$/.test(token) ? { id, token } : null;
}
