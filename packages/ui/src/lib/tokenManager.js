class TokenManager {
    constructor() {
      this.refreshInProgress = false;
      this.lastRefreshPromise = null;
      this.lastCleanupTime = 0;
      this.cleanupInterval = 60 * 60 * 1000;
    }
  
    shouldRefreshToken() {
      const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");
      if (!tokenExpiry) return true;
  
      const expiryTime = new Date(tokenExpiry);
      const currentTime = new Date();
      return expiryTime <= new Date(currentTime.getTime() + 5 * 60000);
    }
  
    async refreshToken(refreshFunction) {
      if (this.refreshInProgress) {
        return this.lastRefreshPromise;
      }
  
      if (!this.shouldRefreshToken()) {
        return null;
      }
  
      try {
        this.refreshInProgress = true;
        this.lastRefreshPromise = refreshFunction();
        return await this.lastRefreshPromise;
      } finally {
        this.refreshInProgress = false;
        this.lastRefreshPromise = null;
      }
    }
  
    shouldCleanup() {
      const currentTime = Date.now();
      if (currentTime - this.lastCleanupTime < this.cleanupInterval) {
        return false;
      }
      this.lastCleanupTime = currentTime;
      return true;
    }
  }
  
  export const tokenManager = new TokenManager();