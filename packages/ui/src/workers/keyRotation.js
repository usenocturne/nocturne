export default {
    async scheduled(event, env, ctx) {
      if (event.cron === '0 0 * * 0') {
        try {
          const newMasterKey = crypto.getRandomValues(new Uint8Array(32));
          
          await env.KV.put('previous_master_key', await env.KV.get('current_master_key'));
          await env.KV.put('current_master_key', newMasterKey);
          
          const { success, error } = await rotateKeys(env.SUPABASE);
          
          if (!success) {
            throw new Error(error);
          }
          
          await env.KV.delete('previous_master_key');
          
        } catch (error) {
          console.error('Key rotation failed:', error);
        }
      }
    }
  };