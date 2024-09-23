import { useState, useEffect } from "react";
import Link from "next/link";

export default function Sidebar({ activeSection, setActiveSection }) {
  const [accessToken, setAccessToken] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    setAccessToken(token);
  }, []);

  const handleSectionClick = (section) => {
    setActiveSection(section);
  };

  const ListenNowIcon = ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 156 156"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M78 149.667C117.58 149.667 149.667 117.58 149.667 78C149.667 38.4196 117.58 6.33331 78 6.33331C38.4196 6.33331 6.33337 38.4196 6.33337 78C6.33337 117.58 38.4196 149.667 78 149.667Z"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M61 52L104 78.5L61 105V52Z"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect x="63" y="67" width="31" height="22" fill="white" />
      <rect x="64" y="60" width="14" height="22" fill="white" />
      <rect x="64" y="74" width="14" height="22" fill="white" />
    </svg>
  );

  const RadioIcon = ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 190 133"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M30.6188 126.275C-2.20625 93.45 -2.20625 39.5833 30.6188 6.75833"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M50 107.758C27.3333 85.2995 27.3333 48.1936 50 24.7583"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M67 90.7583C53.6667 77.7701 53.6667 56.3113 67 42.7583"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M140 24.7583C162.667 47.2172 162.667 84.323 140 107.758"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M122 42.7583C135.333 55.7466 135.333 77.2054 122 90.7583"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M158.758 6C191.583 38.825 191.583 91.85 158.758 124.675"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="94.5" cy="66.2583" r="13.5" fill="white" />
    </svg>
  );

  const BrowseIcon = ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 143 143"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6 23.8636C6 19.1259 7.88206 14.5822 11.2321 11.2321C14.5822 7.88206 19.1259 6 23.8636 6H41.7273C46.465 6 51.0087 7.88206 54.3588 11.2321C57.7089 14.5822 59.5909 19.1259 59.5909 23.8636V41.7273C59.5909 46.465 57.7089 51.0087 54.3588 54.3588C51.0087 57.7089 46.465 59.5909 41.7273 59.5909H23.8636C19.1259 59.5909 14.5822 57.7089 11.2321 54.3588C7.88206 51.0087 6 46.465 6 41.7273V23.8636ZM6 101.273C6 96.535 7.88206 91.9913 11.2321 88.6412C14.5822 85.2911 19.1259 83.4091 23.8636 83.4091H41.7273C46.465 83.4091 51.0087 85.2911 54.3588 88.6412C57.7089 91.9913 59.5909 96.535 59.5909 101.273V119.136C59.5909 123.874 57.7089 128.418 54.3588 131.768C51.0087 135.118 46.465 137 41.7273 137H23.8636C19.1259 137 14.5822 135.118 11.2321 131.768C7.88206 128.418 6 123.874 6 119.136V101.273ZM83.4091 23.8636C83.4091 19.1259 85.2911 14.5822 88.6412 11.2321C91.9913 7.88206 96.535 6 101.273 6H119.136C123.874 6 128.418 7.88206 131.768 11.2321C135.118 14.5822 137 19.1259 137 23.8636V41.7273C137 46.465 135.118 51.0087 131.768 54.3588C128.418 57.7089 123.874 59.5909 119.136 59.5909H101.273C96.535 59.5909 91.9913 57.7089 88.6412 54.3588C85.2911 51.0087 83.4091 46.465 83.4091 41.7273V23.8636ZM83.4091 101.273C83.4091 96.535 85.2911 91.9913 88.6412 88.6412C91.9913 85.2911 96.535 83.4091 101.273 83.4091H119.136C123.874 83.4091 128.418 85.2911 131.768 88.6412C135.118 91.9913 137 96.535 137 101.273V119.136C137 123.874 135.118 128.418 131.768 131.768C128.418 135.118 123.874 137 119.136 137H101.273C96.535 137 91.9913 135.118 88.6412 131.768C85.2911 128.418 83.4091 123.874 83.4091 119.136V101.273Z"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );

  const ArtistsIcon = ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 122 165"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M60.6043 6C54.6251 6 48.8907 8.37524 44.6628 12.6032C40.4348 16.8312 38.0596 22.5655 38.0596 28.5447V81.1491C38.0596 87.1283 40.4348 92.8627 44.6628 97.0906C48.8907 101.319 54.6251 103.694 60.6043 103.694C66.5835 103.694 72.3179 101.319 76.5458 97.0906C80.7738 92.8627 83.149 87.1283 83.149 81.1491V28.5447C83.149 22.5655 80.7738 16.8312 76.5458 12.6032C72.3179 8.37524 66.5835 6 60.6043 6Z"
        stroke="white"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M113.209 66.1193V81.1491C113.209 95.1006 107.667 108.481 97.8013 118.346C87.936 128.211 74.5559 133.753 60.6044 133.753C46.6528 133.753 33.2727 128.211 23.4075 118.346C13.5422 108.481 8 95.1006 8 81.1491V66.1193"
        stroke="white"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M60.6044 133.753V156.298"
        stroke="white"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect x="42" y="12" width="37" height="86" fill="white" />
    </svg>
  );

  const SongsIcon = ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 137 168"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M134.639 1.19827C135.373 1.7534 135.968 2.4716 136.378 3.2963C136.788 4.12101 137.001 5.0297 137 5.95082V117.449C136.999 122.621 135.316 127.652 132.205 131.781C129.094 135.909 124.725 138.911 119.759 140.331L109.301 143.323C106.735 144.094 104.042 144.347 101.378 144.067C98.7135 143.788 96.1313 142.981 93.781 141.694C91.4306 140.407 89.359 138.665 87.6863 136.57C86.0136 134.475 84.7732 132.067 84.037 129.488C83.3009 126.909 83.0837 124.209 83.3981 121.545C83.7124 118.881 84.5521 116.306 85.8683 113.969C87.1845 111.633 88.951 109.582 91.0653 107.934C93.1796 106.287 95.5996 105.077 98.1847 104.374L116.495 99.1374C118.978 98.4271 121.163 96.9263 122.718 94.862C124.273 92.7977 125.115 90.2823 125.115 87.6963V43.5904L53.8075 63.997V141.252C53.8064 146.424 52.1232 151.455 49.0125 155.583C45.9018 159.712 41.5329 162.713 36.5668 164.134L26.1084 167.125C23.5394 167.907 20.8408 168.168 18.1698 167.895C15.4988 167.621 12.9089 166.818 10.5511 165.532C8.19337 164.246 6.1149 162.502 4.43691 160.403C2.75893 158.304 1.51501 155.892 0.777684 153.307C0.0403584 150.721 -0.175619 148.015 0.142347 145.345C0.460312 142.676 1.30586 140.096 2.62968 137.757C3.9535 135.418 5.72911 133.366 7.85298 131.721C9.97684 130.076 12.4065 128.871 15.0002 128.176L33.3025 122.94C35.7856 122.23 37.97 120.729 39.5254 118.664C41.0807 116.6 41.9223 114.085 41.9229 111.499V29.7533C41.9231 28.4603 42.3439 27.2026 43.1216 26.1704C43.8993 25.1383 44.9915 24.3879 46.233 24.0327L129.426 0.230304C130.31 -0.0235526 131.241 -0.0682554 132.146 0.0997184C133.051 0.267692 133.904 0.643753 134.639 1.19827Z"
        fill="white"
      />
    </svg>
  );

  return (
    <div className="space-y-6 pt-12">
      <Link href={`/now-playing?accessToken=${accessToken}`}>
        <div className="relative flex items-center">
          <div className="mr-4 flex-shrink-0">
            <div className="h-14 w-14 bg-white/25 rounded-[12px] flex items-center justify-center">
              <ListenNowIcon className="h-8 w-8" />
            </div>
          </div>
          <div>
            <h4 className="ml-1 text-[24px] font-medium text-white">
              Now Playing
            </h4>
          </div>
        </div>
      </Link>
      <div
        className="relative flex items-center"
        onClick={() => handleSectionClick("recents")}
      >
        {activeSection === "recents" && (
          <div className="absolute left-[-19px] top-1/2 transform -translate-y-1/2 h-8 w-1.5 bg-white rounded-full" />
        )}
        <div className="mr-4 flex-shrink-0">
          <div className="h-14 w-14 bg-white/25 rounded-[12px] flex items-center justify-center">
            <RadioIcon className="h-8 w-8" />
          </div>
        </div>
        <div>
          <h4 className="ml-1 text-[24px] font-medium text-white">Recents</h4>
        </div>
      </div>
      <div
        className="relative flex items-center"
        onClick={() => handleSectionClick("browse")}
      >
        {activeSection === "browse" && (
          <div className="absolute left-[-19px] top-1/2 transform -translate-y-1/2 h-8 w-1.5 bg-white rounded-full" />
        )}
        <div className="mr-4 flex-shrink-0">
          <div className="h-14 w-14 bg-white/25 rounded-[12px] flex items-center justify-center">
            <BrowseIcon className="h-8 w-8" />
          </div>
        </div>
        <div>
          <h4 className="ml-1 text-[24px] font-medium text-white">Browse</h4>
        </div>
      </div>
      <div
        className="relative flex items-center"
        onClick={() => handleSectionClick("artists")}
      >
        {activeSection === "artists" && (
          <div className="absolute left-[-19px] top-1/2 transform -translate-y-1/2 h-8 w-1.5 bg-white rounded-full" />
        )}
        <div className="mr-4 flex-shrink-0">
          <div className="h-14 w-14 bg-white/25 rounded-[12px] flex items-center justify-center">
            <ArtistsIcon className="h-8 w-8" />
          </div>
        </div>
        <div>
          <h4 className="ml-1 text-[24px] font-medium text-white">Artists</h4>
        </div>
      </div>
      <div
        className="relative flex items-center"
        onClick={() => handleSectionClick("songs")}
      >
        {activeSection === "songs" && (
          <div className="absolute left-[-19px] top-1/2 transform -translate-y-1/2 h-8 w-1.5 bg-white rounded-full" />
        )}
        <div className="mr-4 flex-shrink-0">
          <div className="h-14 w-14 bg-white/25 rounded-[12px] flex items-center justify-center">
            <SongsIcon className="h-8 w-8" />
          </div>
        </div>
        <div>
          <h4 className="ml-1 text-[24px] font-medium text-white">Songs</h4>
        </div>
      </div>
    </div>
  );
}
