// Minimal document.cookie helpers for small string preferences (e.g. the
// remembered Designer name). Values are URI-encoded so they survive "=" / ";".

export function getCookie(name: string): string {
  const prefix = name + "=";
  const row = document.cookie.split("; ").find((r) => r.startsWith(prefix));
  return row ? decodeURIComponent(row.slice(prefix.length)) : "";
}

export function setCookie(name: string, value: string, days = 365): void {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}
