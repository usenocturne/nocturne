import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-line bg-bg px-6">
        <div>
          <div className="mx-auto max-w-5xl">
            <div className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
              <Logo className="h-9" />
              <p className="text-sm text-muted">
                &copy; {new Date().getFullYear()} Vanta Labs.
              </p>
            </div>
            <div className="border-t border-line py-6">
              <p className="text-sm text-muted">
                "Spotify" and "Car Thing" are trademarks of Spotify AB. This
                software is not affiliated with or endorsed by Spotify AB.
              </p>
            </div>
          </div>
        </div>
    </footer>
  );
}
