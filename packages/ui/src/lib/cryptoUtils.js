function hexToUint8Array(hexString) {
    return new Uint8Array(
      hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
    );
  }
  
  function uint8ArrayToHex(bytes) {
    return Array.from(bytes)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  
  function stringToUint8Array(str) {
    return new TextEncoder().encode(str);
  }
  
  function uint8ArrayToString(bytes) {
    return new TextDecoder().decode(bytes);
  }
  
  export async function encrypt(text) {
    if (!process.env.ENCRYPTION_KEY || !process.env.ENCRYPTION_IV) {
      throw new Error('Encryption keys not configured');
    }
  
    const key = hexToUint8Array(process.env.ENCRYPTION_KEY);
    const iv = hexToUint8Array(process.env.ENCRYPTION_IV);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-CBC' },
      false,
      ['encrypt']
    );
  
    const encoded = stringToUint8Array(text);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-CBC',
        iv
      },
      cryptoKey,
      encoded
    );
  
    return uint8ArrayToHex(new Uint8Array(ciphertext));
  }
  
  export async function decrypt(encryptedHex) {
    if (!process.env.ENCRYPTION_KEY || !process.env.ENCRYPTION_IV) {
      throw new Error('Encryption keys not configured');
    }
  
    const key = hexToUint8Array(process.env.ENCRYPTION_KEY);
    const iv = hexToUint8Array(process.env.ENCRYPTION_IV);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );
  
    const encryptedBytes = hexToUint8Array(encryptedHex);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-CBC',
        iv
      },
      cryptoKey,
      encryptedBytes
    );
  
    return uint8ArrayToString(new Uint8Array(decrypted));
  }