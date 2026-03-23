export default function Navbar() {
  return (
    <nav
      className="sticky top-0 z-50 border-b border-border bg-card"
      style={{ paddingTop: "var(--safe-area-inset-top)" }}
    >
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center">
          <div className="flex items-center space-x-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <img
                src="/brand/logo-mark.png"
                alt=""
                draggable={false}
                className="h-5 w-5 object-contain"
              />
            </div>
            <span className="text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl font-bold text-foreground">
              Bar Fest
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
}
