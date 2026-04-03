import { useEffect, useRef, useState } from 'react';
import styles from './Licenses.module.scss';

const UI_LICENSE_FILEPATH = 'license/ui-license.txt';
const MW_LICENSE_FILEPATH = 'license/mw-license.txt';
const OS_LICENSE_FILEPATH = 'license/os-license.txt';

async function fetchTextFile(path) {
  try {
    const resp = await fetch(path);
    if (!resp.ok) return '';
    const contentType = resp.headers.get('content-type') || '';
    // Reject HTML responses (SPA fallback for missing files)
    if (contentType.includes('text/html')) return '';
    return await resp.text();
  } catch {
    return '';
  }
}

const Licenses = () => {
  const [licenseText, setLicenseText] = useState('');
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchLicenses() {
      const texts = await Promise.all([
        fetchTextFile(UI_LICENSE_FILEPATH),
        fetchTextFile(MW_LICENSE_FILEPATH),
        fetchTextFile(OS_LICENSE_FILEPATH),
      ]);
      if (mountedRef.current) {
        const combined = texts.filter(Boolean).join('\n\n');
        setLicenseText(combined || 'No license files found.');
        setLoading(false);
      }
    }
    fetchLicenses();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <div className={styles.licenses}>
      <div className={styles.header}>Third-party licenses</div>
      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : (
        <div className={styles.textContainer}>
          <pre className={styles.licenseText}>{licenseText}</pre>
        </div>
      )}
    </div>
  );
};

export default Licenses;
