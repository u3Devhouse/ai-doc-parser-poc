export function isAdminAuthorized(headerValue: string | null): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return false;
  }
  if (!headerValue) {
    return false;
  }
  const token = headerValue.startsWith("Bearer ") ? headerValue.slice(7) : headerValue;
  return token === expected;
}
