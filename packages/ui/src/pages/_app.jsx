import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  return (
    <main>
      <div className="overflow-hidden">
        <Component {...pageProps} />
      </div>
    </main>
  );
}
