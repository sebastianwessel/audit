export function buildUserQuery(userId: string): { text: string; values: [string] } {
  return { text: 'SELECT * FROM users WHERE id = $1', values: [userId] };
}
