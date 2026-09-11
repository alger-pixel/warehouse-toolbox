import scrypt from 'scrypt-js';

// OWASP scrypt profile: 32 MiB, three passes. Versioned for future login verification.
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bytes = new TextEncoder().encode(password);
  try {
    const key = await scrypt.scrypt(bytes, salt, 32768, 8, 3, 32);
    const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
    return `scrypt$v=1$N=32768,r=8,p=3$${hex(salt)}$${hex(key)}`;
  } finally { bytes.fill(0); }
}
