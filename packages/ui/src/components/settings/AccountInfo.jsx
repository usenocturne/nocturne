export default function AccountInfo({userProfile}) {
    if (!userProfile) return null;

    return (
      <div className="mb-8">
        <div className="flex items-center mb-6">
          {userProfile.images?.[0]?.url && (
            <img
              src={userProfile.images[0].url}
              alt="Profile"
              className="w-24 h-24 rounded-full mr-4"
            />
          )}
          <div>
            <h3 className="text-[32px] font-[580] text-white tracking-tight">
              {userProfile.display_name}
            </h3>
            <p className="text-[24px] font-[560] text-white/60 tracking-tight">
              {userProfile.email}
            </p>
          </div>
        </div>
      </div>
    );
}