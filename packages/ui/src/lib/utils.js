export function generateRandomString(length) {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);

  window.crypto.getRandomValues(randomValues);

  for (let i = 0; i < length; i++) {
    result += characters[randomValues[i] % characters.length];
  }

  return result;
}
