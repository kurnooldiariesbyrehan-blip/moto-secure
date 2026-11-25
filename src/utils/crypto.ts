export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateSalt(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

async function derivePbkdf2Bits(secret: string, saltBytes: Uint8Array, iterations = 100000): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
}

export async function hashSecretForVerification(secret: string, saltBase64: string): Promise<string> {
  const saltBytes = fromBase64(saltBase64);
  const suffix = new TextEncoder().encode(':verify');
  const combined = new Uint8Array(saltBytes.length + suffix.length);
  combined.set(saltBytes);
  combined.set(suffix, saltBytes.length);
  const bits = await derivePbkdf2Bits(secret, combined);
  return toBase64(new Uint8Array(bits));
}

export async function deriveWrappingKey(secret: string, saltBase64: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const saltBytes = fromBase64(saltBase64);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function generateMasterKeyBytes(): Promise<Uint8Array> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function importAesKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function wrapMasterKey(masterKeyBytes: Uint8Array, wrappingKey: CryptoKey): Promise<{ wrappedBase64: string; ivBase64: string }> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    wrappingKey,
    masterKeyBytes as BufferSource
  );
  return {
    wrappedBase64: toBase64(new Uint8Array(ciphertext)),
    ivBase64: toBase64(iv),
  };
}

export async function unwrapMasterKey(wrappedBase64: string, ivBase64: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const iv = fromBase64(ivBase64);
  const ciphertext = fromBase64(wrappedBase64);
  const rawBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    wrappingKey,
    ciphertext as BufferSource
  );
  return importAesKey(new Uint8Array(rawBuffer));
}

export async function exportCryptoKeyBytes(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

export async function encryptBuffer(data: ArrayBuffer, key: CryptoKey): Promise<{ ivBase64: string; encryptedBytes: ArrayBuffer }> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encryptedBytes = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    data
  );
  return {
    ivBase64: toBase64(iv),
    encryptedBytes,
  };
}

export async function decryptBuffer(encryptedBytes: ArrayBuffer, ivBase64: string, key: CryptoKey): Promise<ArrayBuffer> {
  const iv = fromBase64(ivBase64);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encryptedBytes
  );
}

export async function isPlatformBiometricAvailable(): Promise<boolean> {
  try {
    if (
      typeof window === 'undefined' ||
      !window.PublicKeyCredential ||
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
    ) {
      return false;
    }
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function enrollWebAuthnBiometric(): Promise<{ usedWebAuthn: boolean; credentialId?: string }> {
  try {
    const available = await isPlatformBiometricAvailable();
    if (!available || !navigator.credentials?.create) {
      return { usedWebAuthn: false };
    }
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'Moto Secure Folder',
        },
        user: {
          id: userId,
          name: 'secure-folder-owner',
          displayName: 'Device Owner',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        timeout: 45000,
      },
    })) as PublicKeyCredential | null;

    if (cred) {
      return {
        usedWebAuthn: true,
        credentialId: toBase64(new Uint8Array(cred.rawId)),
      };
    }
    return { usedWebAuthn: false };
  } catch {
    // Graceful fallback when running in sandboxed preview iframe or desktop without sensor
    return { usedWebAuthn: false };
  }
}

export async function verifyWebAuthnBiometric(credentialId?: string): Promise<'verified' | 'cancelled' | 'unavailable'> {
  if (!credentialId || !navigator.credentials?.get) {
    return 'unavailable';
  }
  try {
    const available = await isPlatformBiometricAvailable();
    if (!available) return 'unavailable';
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            id: fromBase64(credentialId) as BufferSource,
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 45000,
      },
    });
    return assertion ? 'verified' : 'cancelled';
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
      // Could be user cancel OR iframe permissions policy block; check if inside iframe
      if (window.self !== window.top) {
        return 'unavailable';
      }
      return 'cancelled';
    }
    return 'unavailable';
  }
}
