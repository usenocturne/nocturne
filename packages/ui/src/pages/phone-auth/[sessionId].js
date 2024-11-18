import { useState } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';

const PhoneAuthSuccess = () => {
  const NocturneIcon = ({ className }) => (
    <svg
      width="457"
      height="452"
      viewBox="0 0 457 452"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        opacity="0.8"
        d="M337.506 24.9087C368.254 85.1957 385.594 153.463 385.594 225.78C385.594 298.098 368.254 366.366 337.506 426.654C408.686 387.945 457 312.505 457 225.781C457 139.057 408.686 63.6173 337.506 24.9087Z"
        fill="#CBCBCB"
      />
      <path
        d="M234.757 20.1171C224.421 5.47596 206.815 -2.40914 189.157 0.65516C81.708 19.3019 0 112.999 0 225.781C0 338.562 81.7075 432.259 189.156 450.906C206.814 453.97 224.42 446.085 234.756 431.444C275.797 373.304 299.906 302.358 299.906 225.78C299.906 149.203 275.797 78.2567 234.757 20.1171Z"
        fill="white"
      />
    </svg>
  );

  return (
    <div className="h-screen bg-black p-6 flex flex-col items-center justify-center">
      <div className="w-full max-w-md text-center">
        <NocturneIcon className="h-14 w-auto mx-auto mb-8" />
        <h1 className="text-4xl font-bold text-white mb-4">
          Successfully Connected!
        </h1>
        <p className="text-white/70 text-xl mb-8">
          You can now close this window and return to Nocturne.
        </p>
        <div className="animate-pulse text-white/50">
          This window will close automatically...
        </div>
      </div>
    </div>
  );
};

export default function PhoneAuth() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const router = useRouter();
  const { sessionId } = router.query;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const tempId = crypto.randomUUID();
      const validationResponse = await fetch('/api/v1/auth/validate-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, tempId, method: 'qr' }),
      });

      if (!validationResponse.ok) {
        throw new Error('Invalid credentials');
      }

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      );

      await supabase
        .from('qr_sessions')
        .update({
          status: 'completed',
          temp_id: tempId,
          completed_at: new Date().toISOString()
        })
        .eq('session_id', sessionId);

      setIsSubmitting(false);
      setIsSuccess(true);
      
      setTimeout(() => {
        window.close();
      }, 3000);

    } catch (error) {
      setIsSubmitting(false);
      alert('Error: ' + error.message);
    }
  };

  const NocturneIcon = ({ className }) => (
    <svg
      width="457"
      height="452"
      viewBox="0 0 457 452"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        opacity="0.8"
        d="M337.506 24.9087C368.254 85.1957 385.594 153.463 385.594 225.78C385.594 298.098 368.254 366.366 337.506 426.654C408.686 387.945 457 312.505 457 225.781C457 139.057 408.686 63.6173 337.506 24.9087Z"
        fill="#CBCBCB"
      />
      <path
        d="M234.757 20.1171C224.421 5.47596 206.815 -2.40914 189.157 0.65516C81.708 19.3019 0 112.999 0 225.781C0 338.562 81.7075 432.259 189.156 450.906C206.814 453.97 224.42 446.085 234.756 431.444C275.797 373.304 299.906 302.358 299.906 225.78C299.906 149.203 275.797 78.2567 234.757 20.1171Z"
        fill="white"
      />
    </svg>
  );

  if (isSuccess) {
    return <PhoneAuthSuccess />;
  }

  return (
    <div className="h-screen bg-black p-6 flex flex-col sm:items-center pt-24">
      <div className="w-full max-w-md">
        <NocturneIcon className="h-14 mb-8 w-auto sm:mx-auto" />
        <h1 className="text-4xl font-bold text-white mb-8 mt-4 sm:text-center">
          Enter Spotify Credentials
        </h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
            className="w-full rounded-2xl border-0 bg-black/10 py-4 px-6 text-white shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-white/20 ring-white/10 text-2xl"
            required
          />
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Client Secret"
            className="w-full rounded-2xl border-0 bg-black/10 py-4 px-6 text-white shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-white/20 ring-white/10 text-2xl"
            required
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-white/10 px-6 py-4 text-2xl font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}