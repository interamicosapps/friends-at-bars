import { Outlet, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import Footer from "./Footer";

export default function Layout() {
  const location = useLocation();
  const isActivities = location.pathname === "/";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main
        className={
          isActivities
            ? "flex-1 min-h-0 w-full overflow-hidden"
            : "container mx-auto flex-1 px-4 py-8"
        }
      >
        <div className={isActivities ? "h-full min-h-0" : ""}>
          <Outlet />
        </div>
      </main>
      {!isActivities && <Footer />}
    </div>
  );
}
