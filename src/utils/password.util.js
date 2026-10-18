import bcrypt from "bcrypt";

const salt = 10;

/**
 * Hashes a plain-text password using bcrypt
 * @param {string} password - The plain-text password to hash
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  return await bcrypt.hash(password, salt);
}

/**
 * Compares a plain-text password with a hashed password
 * @param {string} password - The plain-text password to compare
 * @param {string} hash - The hashed password to compare against
 * @returns {Promise<boolean>}
 */
export async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}
