/**
 * WebAuthn Client-Side Library
 * 
 * Handles passkey registration and authentication using the Web Authentication API.
 * This provides passwordless authentication using biometrics, security keys, or PIN.
 * 
 * Features:
 * - Passkey registration (create new credentials)
 * - Passkey authentication (sign in with existing credentials)
 * - Discoverable credentials support (usernameless login)
 * - Cross-device authentication (QR code scanning)
 * 
 * Browser Support:
 * - Chrome 67+
 * - Safari 14+
 * - Firefox 60+
 * - Edge 79+
 */

/**
 * Check if WebAuthn is supported in this browser
 * @returns {boolean}
 */
function isWebAuthnSupported() {
  return !!(
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === 'function'
  );
}

/**
 * Check if platform authenticator is available (Face ID, Touch ID, Windows Hello)
 * @returns {Promise<boolean>}
 */
async function isPlatformAuthenticatorAvailable() {
  if (!isWebAuthnSupported()) return false;
  
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Check if conditional UI (autofill-assisted) is available
 * @returns {Promise<boolean>}
 */
async function isConditionalUIAvailable() {
  if (!isWebAuthnSupported()) return false;
  
  try {
    if (PublicKeyCredential.isConditionalMediationAvailable) {
      return await PublicKeyCredential.isConditionalMediationAvailable();
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Convert base64url string to ArrayBuffer
 * @param {string} base64url 
 * @returns {ArrayBuffer}
 */
function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Convert ArrayBuffer to base64url string
 * @param {ArrayBuffer} buffer 
 * @returns {string}
 */
function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Register a new passkey
 * 
 * @param {string} authenticatorType - 'platform' or 'cross-platform'
 * @param {string} name - User-friendly name for the passkey
 * @returns {Promise<{success: boolean, message?: string, passkey?: object}>}
 */
async function registerPasskey(authenticatorType = 'platform', name = '') {
  try {
    // Step 1: Get registration options from server
    const optionsResponse = await fetch('/webauthn/register/options', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ authenticatorType }),
      credentials: 'include'
    });
    
    if (!optionsResponse.ok) {
      const error = await optionsResponse.json();
      throw new Error(error.message || 'Failed to get registration options');
    }
    
    const { options } = await optionsResponse.json();
    
    // Step 2: Convert options for WebAuthn API
    const publicKeyCredentialCreationOptions = {
      ...options,
      challenge: base64urlToBuffer(options.challenge),
      user: {
        ...options.user,
        id: base64urlToBuffer(options.user.id)
      },
      excludeCredentials: (options.excludeCredentials || []).map(cred => ({
        ...cred,
        id: base64urlToBuffer(cred.id)
      }))
    };
    
    // Step 3: Create credential via browser API
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });
    
    if (!credential) {
      throw new Error('Credential creation was cancelled');
    }
    
    // Step 4: Prepare credential for server verification
    const credentialForServer = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      response: {
        attestationObject: bufferToBase64url(credential.response.attestationObject),
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON)
      }
    };
    
    // Include transports if available
    if (credential.response.getTransports) {
      credentialForServer.response.transports = credential.response.getTransports();
    }
    
    // Step 5: Send to server for verification
    const verifyResponse = await fetch('/webauthn/register/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credential: credentialForServer,
        name
      }),
      credentials: 'include'
    });
    
    const result = await verifyResponse.json();
    
    if (!verifyResponse.ok) {
      throw new Error(result.message || 'Registration verification failed');
    }
    
    return {
      success: true,
      message: 'Passkey registered successfully',
      passkey: result.passkey
    };
    
  } catch (error) {
    console.error('Passkey registration error:', error);
    
    // Handle specific WebAuthn errors
    if (error.name === 'InvalidStateError') {
      return {
        success: false,
        message: 'This authenticator is already registered'
      };
    }
    if (error.name === 'NotAllowedError') {
      return {
        success: false,
        message: 'Authentication was cancelled or timed out'
      };
    }
    if (error.name === 'NotSupportedError') {
      return {
        success: false,
        message: 'This authenticator is not supported'
      };
    }
    
    return {
      success: false,
      message: error.message || 'Failed to register passkey'
    };
  }
}

/**
 * Authenticate with a passkey
 * 
 * @param {string} email - Optional email to find user's passkeys
 * @returns {Promise<{success: boolean, message?: string, user?: object, redirect?: string}>}
 */
async function loginWithPasskey(email = null) {
  try {
    // Step 1: Get authentication options from server
    const optionsResponse = await fetch('/webauthn/login/options', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
      credentials: 'include'
    });
    
    if (!optionsResponse.ok) {
      const error = await optionsResponse.json();
      throw new Error(error.message || 'Failed to get authentication options');
    }
    
    const { options } = await optionsResponse.json();
    
    // Step 2: Convert options for WebAuthn API
    const publicKeyCredentialRequestOptions = {
      ...options,
      challenge: base64urlToBuffer(options.challenge),
      allowCredentials: (options.allowCredentials || []).map(cred => ({
        ...cred,
        id: base64urlToBuffer(cred.id)
      }))
    };
    
    // Step 3: Get credential via browser API
    const credential = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions
    });
    
    if (!credential) {
      throw new Error('Authentication was cancelled');
    }
    
    // Step 4: Prepare credential for server verification
    const credentialForServer = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      response: {
        authenticatorData: bufferToBase64url(credential.response.authenticatorData),
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
        signature: bufferToBase64url(credential.response.signature),
        userHandle: credential.response.userHandle 
          ? bufferToBase64url(credential.response.userHandle)
          : null
      }
    };
    
    // Step 5: Send to server for verification
    const verifyResponse = await fetch('/webauthn/login/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ credential: credentialForServer }),
      credentials: 'include'
    });
    
    const result = await verifyResponse.json();
    
    if (!verifyResponse.ok) {
      throw new Error(result.message || 'Authentication failed');
    }
    
    return {
      success: true,
      message: 'Authentication successful',
      user: result.user,
      redirect: result.redirect
    };
    
  } catch (error) {
    console.error('Passkey authentication error:', error);
    
    // Handle specific WebAuthn errors
    if (error.name === 'NotAllowedError') {
      return {
        success: false,
        message: 'Authentication was cancelled or timed out'
      };
    }
    if (error.name === 'SecurityError') {
      return {
        success: false,
        message: 'Security error - please ensure you\'re using HTTPS'
      };
    }
    
    return {
      success: false,
      message: error.message || 'Authentication failed'
    };
  }
}

/**
 * List user's registered passkeys
 * @returns {Promise<{success: boolean, passkeys?: array, message?: string}>}
 */
async function listPasskeys() {
  try {
    const response = await fetch('/webauthn/credentials', {
      method: 'GET',
      credentials: 'include'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to list passkeys');
    }
    
    const result = await response.json();
    return {
      success: true,
      passkeys: result.passkeys
    };
    
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Rename a passkey
 * @param {string} passkeyId 
 * @param {string} newName 
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function renamePasskey(passkeyId, newName) {
  try {
    const response = await fetch(`/webauthn/credentials/${passkeyId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newName }),
      credentials: 'include'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to rename passkey');
    }
    
    return { success: true, message: 'Passkey renamed' };
    
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Delete a passkey
 * @param {string} passkeyId 
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function deletePasskey(passkeyId) {
  try {
    const response = await fetch(`/webauthn/credentials/${passkeyId}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete passkey');
    }
    
    return { success: true, message: 'Passkey deleted' };
    
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isWebAuthnSupported,
    isPlatformAuthenticatorAvailable,
    isConditionalUIAvailable,
    registerPasskey,
    loginWithPasskey,
    listPasskeys,
    renamePasskey,
    deletePasskey
  };
}
