export default {
    async scheduled(event, env, ctx) {
      try {
        const newKey = crypto.getRandomValues(new Uint8Array(32));
        const newIV = crypto.getRandomValues(new Uint8Array(16));
        
        const currentKey = await env.ENCRYPTION_KEYS.get('current_key');
        const currentIV = await env.ENCRYPTION_KEYS.get('current_iv');
        
        if (currentKey && currentIV) {
          await env.ENCRYPTION_KEYS.put('backup_key', currentKey);
          await env.ENCRYPTION_KEYS.put('backup_iv', currentIV);
        }
  
        await env.ENCRYPTION_KEYS.put('current_key', Buffer.from(newKey).toString('hex'));
        await env.ENCRYPTION_KEYS.put('current_iv', Buffer.from(newIV).toString('hex'));
  
        console.log('Key rotation completed successfully');
      } catch (error) {
        console.error('Key rotation failed:', error);
        
        const backupKey = await env.ENCRYPTION_KEYS.get('backup_key');
        const backupIV = await env.ENCRYPTION_KEYS.get('backup_iv');
        
        if (backupKey && backupIV) {
          await env.ENCRYPTION_KEYS.put('current_key', backupKey);
          await env.ENCRYPTION_KEYS.put('current_iv', backupIV);
        }
      }
    }
  };