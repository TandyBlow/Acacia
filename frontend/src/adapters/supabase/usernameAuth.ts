const SYNTHETIC_EMAIL_DOMAIN = 'seewhat.local';

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function usernameToSyntheticEmail(username: string): Promise<string> {
  const hash = await sha256Hex(username);
  return `u.${hash}@${SYNTHETIC_EMAIL_DOMAIN}`;
}
