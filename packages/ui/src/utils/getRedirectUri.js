export const getRedirectUri = () => {
    if (typeof window === 'undefined') {
      return process.env.NEXT_PUBLIC_REDIRECT_URI;
    }
    return `${window.location.origin}`;
  };