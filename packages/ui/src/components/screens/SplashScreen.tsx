function SplashScreen() {
  return (
    <div className="fixed inset-0 bg-[#2d2d2d] flex items-center justify-center z-50">
      <img
        src="/images/appstart.png"
        alt="Nocturne"
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}

export default SplashScreen;
