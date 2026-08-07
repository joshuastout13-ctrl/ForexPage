import bcrypt from "bcryptjs";

/**
 * Safely verifies a password against a stored string or bcrypt hash.
 * Supports legacy plaintext passwords and modern bcrypt hashes ($2a$, $2b$, $2y$).
 * Never logs passwords or hashes.
 */
export function verifyPassword(inputPassword, storedPasswordOrHash) {
  if (!inputPassword || !storedPasswordOrHash) return false;

  const input = String(inputPassword).trim();
  const stored = String(storedPasswordOrHash).trim();

  // Check if stored string is a bcrypt hash
  if (/^\$2[aby]\$\d{2}\$/.test(stored)) {
    try {
      return bcrypt.compareSync(input, stored);
    } catch {
      return false;
    }
  }

  // Legacy plaintext fallback
  return input === stored;
}

/**
 * Hashes a plaintext password using bcrypt with salt rounds = 10.
 */
export function hashPassword(plaintextPassword) {
  if (!plaintextPassword) throw new Error("Password cannot be empty");
  return bcrypt.hashSync(String(plaintextPassword).trim(), 10);
}
