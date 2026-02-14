/**
 * WebAuthn Utility Functions
 * Handles passkey/WebAuthn challenge generation and verification
 * 
 * This implements the WebAuthn standard for passwordless authentication:
 * - Registration: Create and store new passkey credentials
 * - Authentication: Verify passkey signatures
 * 
 * Security features:
 * - Challenge freshness (30 second expiry)
 * - Counter validation (replay attack prevention)
 * - Origin verification
 * - User verification checks
 */

const crypto = require('crypto');
const base64url = require('base64url');

// Challenge storage (in production, use Redis with TTL)
const challenges = new Map();
const CHALLENGE_TIMEOUT = 30000; // 30 seconds

/**
 * Generate a random challenge
 * @returns {string} Base64URL encoded challenge
 */
function generateChallenge() {
  return base64url.encode(crypto.randomBytes(32));
}

/**
 * Store challenge for verification
 * @param {string} key - User ID or session ID
 * @param {string} challenge - The challenge to store
 * @param {string} type - 'registration' or 'authentication'
 */
function storeChallenge(key, challenge, type) {
  const expiry = Date.now() + CHALLENGE_TIMEOUT;
  challenges.set(`${type}:${key}`, { challenge, expiry });
  
  // Clean up expired challenges periodically
  setTimeout(() => {
    challenges.delete(`${type}:${key}`);
  }, CHALLENGE_TIMEOUT + 1000);
}

/**
 * Retrieve and invalidate challenge
 * @param {string} key - User ID or session ID
 * @param {string} type - 'registration' or 'authentication'
 * @returns {string|null} The stored challenge or null if expired/not found
 */
function getChallenge(key, type) {
  const stored = challenges.get(`${type}:${key}`);
  
  if (!stored) {
    return null;
  }
  
  // Delete the challenge (one-time use)
  challenges.delete(`${type}:${key}`);
  
  // Check expiry
  if (Date.now() > stored.expiry) {
    return null;
  }
  
  return stored.challenge;
}

/**
 * Generate registration options for WebAuthn
 * @param {Object} user - User object with id, email, username
 * @param {Array} existingCredentials - User's existing passkey credential IDs
 * @param {Object} options - Additional options
 * @returns {Object} PublicKeyCredentialCreationOptions
 */
function generateRegistrationOptions(user, existingCredentials = [], options = {}) {
  const {
    rpName = process.env.APP_NAME || 'NexusAuth',
    rpId = process.env.RP_ID || 'localhost',
    attestation = 'none',
    authenticatorSelection = {}
  } = options;
  
  const challenge = generateChallenge();
  
  // Store challenge for verification
  storeChallenge(user._id.toString(), challenge, 'registration');
  
  const registrationOptions = {
    challenge,
    rp: {
      name: rpName,
      id: rpId
    },
    user: {
      id: base64url.encode(user._id.toString()),
      name: user.email,
      displayName: user.username || user.email.split('@')[0]
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },   // ES256
      { alg: -257, type: 'public-key' }, // RS256
      { alg: -8, type: 'public-key' }    // EdDSA
    ],
    timeout: 60000,
    attestation,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: authenticatorSelection.authenticatorAttachment || undefined,
      ...authenticatorSelection
    },
    excludeCredentials: existingCredentials.map(credId => ({
      id: credId,
      type: 'public-key',
      transports: ['internal', 'hybrid', 'usb', 'ble', 'nfc']
    }))
  };
  
  return registrationOptions;
}

/**
 * Verify registration response
 * @param {Object} response - The credential response from navigator.credentials.create()
 * @param {string} userId - The user's ID
 * @param {string} expectedOrigin - Expected origin (e.g., 'https://example.com')
 * @param {string} expectedRpId - Expected RP ID
 * @returns {Object} Verified credential data
 */
async function verifyRegistration(response, userId, expectedOrigin, expectedRpId) {
  const { id, rawId, response: attestationResponse, type } = response;
  
  if (type !== 'public-key') {
    throw new Error('Invalid credential type');
  }
  
  // Get stored challenge
  const expectedChallenge = getChallenge(userId, 'registration');
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found');
  }
  
  // Decode attestation data
  const clientDataJSON = JSON.parse(
    Buffer.from(attestationResponse.clientDataJSON, 'base64').toString()
  );
  
  // Verify client data
  if (clientDataJSON.type !== 'webauthn.create') {
    throw new Error('Invalid client data type');
  }
  
  if (clientDataJSON.challenge !== expectedChallenge) {
    throw new Error('Challenge mismatch');
  }
  
  // Verify origin
  const clientOrigin = clientDataJSON.origin;
  const allowedOrigins = Array.isArray(expectedOrigin) ? expectedOrigin : [expectedOrigin];
  if (!allowedOrigins.some(origin => clientOrigin === origin || clientOrigin.startsWith(origin))) {
    // Allow localhost in development
    if (process.env.NODE_ENV !== 'development' || !clientOrigin.includes('localhost')) {
      throw new Error('Origin mismatch');
    }
  }
  
  // Parse attestation object
  const attestationBuffer = Buffer.from(attestationResponse.attestationObject, 'base64');
  const attestationObject = decodeAttestationObject(attestationBuffer);
  
  // Extract authenticator data
  const authData = parseAuthenticatorData(attestationObject.authData);
  
  // Verify RP ID hash
  const rpIdHash = crypto.createHash('sha256').update(expectedRpId).digest();
  if (!authData.rpIdHash.equals(rpIdHash)) {
    // Allow localhost in development
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('RP ID mismatch');
    }
  }
  
  // Verify user presence flag
  if (!(authData.flags & 0x01)) {
    throw new Error('User presence flag not set');
  }
  
  // Extract credential data
  const credentialId = base64url.encode(authData.credentialId);
  const publicKey = base64url.encode(authData.credentialPublicKey);
  
  return {
    credentialId,
    publicKey,
    counter: authData.signCount,
    credentialType: 'public-key',
    attestationFormat: attestationObject.fmt,
    aaguid: authData.aaguid ? base64url.encode(authData.aaguid) : null,
    backupEligible: !!(authData.flags & 0x08),
    backupState: !!(authData.flags & 0x10),
    userVerified: !!(authData.flags & 0x04),
    transports: attestationResponse.getTransports ? attestationResponse.getTransports() : []
  };
}

/**
 * Generate authentication options for WebAuthn
 * @param {Array} allowedCredentials - User's existing passkey credential IDs
 * @param {string} userId - User ID (optional, for challenge storage)
 * @param {Object} options - Additional options
 * @returns {Object} PublicKeyCredentialRequestOptions
 */
function generateAuthenticationOptions(allowedCredentials = [], userId = null, options = {}) {
  const {
    rpId = process.env.RP_ID || 'localhost',
    userVerification = 'preferred'
  } = options;
  
  const challenge = generateChallenge();
  const key = userId || challenge; // Use challenge as key if no user ID
  
  // Store challenge for verification
  storeChallenge(key, challenge, 'authentication');
  
  const authenticationOptions = {
    challenge,
    timeout: 60000,
    rpId,
    userVerification,
    allowCredentials: allowedCredentials.length > 0 ? allowedCredentials.map(cred => ({
      id: cred.credentialId || cred,
      type: 'public-key',
      transports: cred.transports || ['internal', 'hybrid', 'usb', 'ble', 'nfc']
    })) : undefined
  };
  
  return { options: authenticationOptions, challengeKey: key };
}

/**
 * Verify authentication response
 * @param {Object} response - The credential response from navigator.credentials.get()
 * @param {Object} passkey - The stored passkey document
 * @param {string} challengeKey - Key used to store the challenge
 * @param {string} expectedOrigin - Expected origin
 * @param {string} expectedRpId - Expected RP ID
 * @returns {Object} Verification result
 */
async function verifyAuthentication(response, passkey, challengeKey, expectedOrigin, expectedRpId) {
  const { id, rawId, response: assertionResponse, type } = response;
  
  if (type !== 'public-key') {
    throw new Error('Invalid credential type');
  }
  
  // Verify credential ID matches
  if (id !== passkey.credentialId && rawId !== passkey.credentialId) {
    throw new Error('Credential ID mismatch');
  }
  
  // Get stored challenge
  const expectedChallenge = getChallenge(challengeKey, 'authentication');
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found');
  }
  
  // Decode client data
  const clientDataJSON = JSON.parse(
    Buffer.from(assertionResponse.clientDataJSON, 'base64').toString()
  );
  
  // Verify client data
  if (clientDataJSON.type !== 'webauthn.get') {
    throw new Error('Invalid client data type');
  }
  
  if (clientDataJSON.challenge !== expectedChallenge) {
    throw new Error('Challenge mismatch');
  }
  
  // Verify origin
  const clientOrigin = clientDataJSON.origin;
  const allowedOrigins = Array.isArray(expectedOrigin) ? expectedOrigin : [expectedOrigin];
  if (!allowedOrigins.some(origin => clientOrigin === origin || clientOrigin.startsWith(origin))) {
    if (process.env.NODE_ENV !== 'development' || !clientOrigin.includes('localhost')) {
      throw new Error('Origin mismatch');
    }
  }
  
  // Parse authenticator data
  const authDataBuffer = Buffer.from(assertionResponse.authenticatorData, 'base64');
  const authData = parseAuthenticatorData(authDataBuffer, false);
  
  // Verify RP ID hash
  const rpIdHash = crypto.createHash('sha256').update(expectedRpId).digest();
  if (!authData.rpIdHash.equals(rpIdHash)) {
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('RP ID mismatch');
    }
  }
  
  // Verify user presence
  if (!(authData.flags & 0x01)) {
    throw new Error('User presence flag not set');
  }
  
  // Verify counter (replay attack prevention)
  if (authData.signCount !== 0 && authData.signCount <= passkey.counter) {
    throw new Error('Invalid counter - possible cloned authenticator');
  }
  
  // Verify signature
  const signatureValid = await verifySignature(
    passkey.publicKey,
    authDataBuffer,
    Buffer.from(assertionResponse.clientDataJSON, 'base64'),
    Buffer.from(assertionResponse.signature, 'base64')
  );
  
  if (!signatureValid) {
    throw new Error('Invalid signature');
  }
  
  return {
    verified: true,
    newCounter: authData.signCount,
    userVerified: !!(authData.flags & 0x04),
    backupState: !!(authData.flags & 0x10)
  };
}

/**
 * Decode CBOR-encoded attestation object
 * Simplified decoder for common attestation formats
 */
function decodeAttestationObject(buffer) {
  // This is a simplified CBOR decoder
  // In production, use a proper CBOR library like 'cbor'
  const cbor = require('cbor');
  return cbor.decodeFirstSync(buffer);
}

/**
 * Parse authenticator data
 * @param {Buffer} authData - Raw authenticator data
 * @param {boolean} hasCredentialData - Whether credential data is present
 * @returns {Object} Parsed authenticator data
 */
function parseAuthenticatorData(authData, hasCredentialData = true) {
  let offset = 0;
  
  // RP ID hash (32 bytes)
  const rpIdHash = authData.slice(offset, offset + 32);
  offset += 32;
  
  // Flags (1 byte)
  const flags = authData[offset];
  offset += 1;
  
  // Sign count (4 bytes, big-endian)
  const signCount = authData.readUInt32BE(offset);
  offset += 4;
  
  const result = { rpIdHash, flags, signCount };
  
  // If attested credential data is present (flag bit 6)
  if (hasCredentialData && (flags & 0x40)) {
    // AAGUID (16 bytes)
    result.aaguid = authData.slice(offset, offset + 16);
    offset += 16;
    
    // Credential ID length (2 bytes, big-endian)
    const credIdLen = authData.readUInt16BE(offset);
    offset += 2;
    
    // Credential ID
    result.credentialId = authData.slice(offset, offset + credIdLen);
    offset += credIdLen;
    
    // Credential public key (COSE format, rest of the data)
    result.credentialPublicKey = authData.slice(offset);
  }
  
  return result;
}

/**
 * Verify assertion signature
 */
async function verifySignature(publicKeyBase64, authData, clientDataJSON, signature) {
  try {
    const publicKeyBuffer = base64url.toBuffer(publicKeyBase64);
    
    // Create hash of client data
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
    
    // Concatenate authenticator data and client data hash
    const signedData = Buffer.concat([authData, clientDataHash]);
    
    // Parse COSE public key and verify
    // This is a simplified verification - in production use @simplewebauthn/server
    const coseKey = require('cbor').decodeFirstSync(publicKeyBuffer);
    
    // Get key type and algorithm
    const kty = coseKey.get(1);  // Key type
    const alg = coseKey.get(3);  // Algorithm
    
    let verifier;
    
    if (kty === 2) { // EC key
      const crv = coseKey.get(-1);
      const x = coseKey.get(-2);
      const y = coseKey.get(-3);
      
      // Create EC public key
      const keyObject = crypto.createPublicKey({
        key: {
          kty: 'EC',
          crv: crv === 1 ? 'P-256' : 'P-384',
          x: base64url.encode(x),
          y: base64url.encode(y)
        },
        format: 'jwk'
      });
      
      verifier = crypto.createVerify(alg === -7 ? 'SHA256' : 'SHA384');
      verifier.update(signedData);
      
      // Convert signature from raw format to DER
      const derSignature = rawSignatureToDER(signature);
      return verifier.verify(keyObject, derSignature);
      
    } else if (kty === 3) { // RSA key
      const n = coseKey.get(-1);
      const e = coseKey.get(-2);
      
      const keyObject = crypto.createPublicKey({
        key: {
          kty: 'RSA',
          n: base64url.encode(n),
          e: base64url.encode(e)
        },
        format: 'jwk'
      });
      
      verifier = crypto.createVerify('SHA256');
      verifier.update(signedData);
      return verifier.verify(keyObject, signature);
    }
    
    return false;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Convert raw ECDSA signature to DER format
 */
function rawSignatureToDER(signature) {
  if (signature.length !== 64) {
    return signature; // Might already be DER
  }
  
  const r = signature.slice(0, 32);
  const s = signature.slice(32, 64);
  
  function toSignedInt(buf) {
    if (buf[0] & 0x80) {
      return Buffer.concat([Buffer.from([0x00]), buf]);
    }
    // Remove leading zeros except when needed for sign
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0 && !(buf[i + 1] & 0x80)) {
      i++;
    }
    return buf.slice(i);
  }
  
  const rDer = toSignedInt(r);
  const sDer = toSignedInt(s);
  
  const sequence = Buffer.concat([
    Buffer.from([0x02, rDer.length]),
    rDer,
    Buffer.from([0x02, sDer.length]),
    sDer
  ]);
  
  return Buffer.concat([
    Buffer.from([0x30, sequence.length]),
    sequence
  ]);
}

module.exports = {
  generateChallenge,
  generateRegistrationOptions,
  verifyRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
  storeChallenge,
  getChallenge
};
