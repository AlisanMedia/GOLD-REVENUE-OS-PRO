import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// Protected-runner helper: never print the passphrase, dump, authentication data or decrypted content.
export function encryptPrivateBetaBackup(bytes, passphrase) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 512 * 1024 * 1024 || typeof passphrase !== 'string' || passphrase.length < 32) throw Error('BACKUP_CUSTODY_REQUIRED');
  const salt = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
  const aad = Buffer.from('GOLD_PRIVATE_BETA_BACKUP1'); cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([aad, salt, iv, cipher.getAuthTag(), ciphertext]);
}
export function decryptPrivateBetaBackup(bytes, passphrase) {
  const prefix = Buffer.from('GOLD_PRIVATE_BETA_BACKUP1');
  if (!Buffer.from(bytes).subarray(0, prefix.length).equals(prefix) || typeof passphrase !== 'string' || passphrase.length < 32 || bytes.length < prefix.length + 60) throw Error('BACKUP_INVALID');
  const body = Buffer.from(bytes), offset = prefix.length;
  const cipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, body.subarray(offset, offset + 32), 32), body.subarray(offset + 32, offset + 44));
  cipher.setAAD(prefix); cipher.setAuthTag(body.subarray(offset + 44, offset + 60));
  return Buffer.concat([cipher.update(body.subarray(offset + 60)), cipher.final()]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, input, output] = process.argv.slice(2);
    if (!['encrypt', 'verify'].includes(command) || !input || !output || statSync(input).size > 512 * 1024 * 1024) throw Error('BACKUP_ARGUMENTS');
    const secret = process.env.STAGING_BACKUP_PASSPHRASE;
    if (command === 'encrypt') writeFileSync(output, encryptPrivateBetaBackup(readFileSync(input), secret), { mode: 0o600 });
    else {
      const decoded = decryptPrivateBetaBackup(readFileSync(input), secret), original = readFileSync(output);
      if (!decoded.equals(original)) throw Error('BACKUP_ENCRYPTION_MISMATCH');
      process.stdout.write(JSON.stringify({ encryption_roundtrip: 'PASS', source_sha256: createHash('sha256').update(original).digest('hex'), encrypted_sha256: createHash('sha256').update(readFileSync(input)).digest('hex') }) + '\n');
    }
  } catch { process.stderr.write('BACKUP_CUSTODY_OR_INTEGRITY_FAILED\n'); process.exitCode = 1; }
}
