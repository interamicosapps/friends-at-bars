import { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";

// Lazy load route components
const Home = lazy(() => import("./pages/Home"));
const Test = lazy(() => import("./pages/Test"));
const About = lazy(() => import("./pages/About"));
const Games = lazy(() => import("./pages/Games"));
const SwitchSearch = lazy(() => import("./pages/SwitchSearch"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Loading fallback component
const LoadingFallback = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="text-center">
      <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
      <p className="text-sm text-gray-600">Loading...</p>
    </div>
  </div>
);

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route
            index
            element={
              <Suspense fallback={<LoadingFallback />}>
                <Home />
              </Suspense>
            }
          />
          <Route
            path="test"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <Test />
              </Suspense>
            }
          />
          <Route
            path="about"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <About />
              </Suspense>
            }
          />
          <Route
            path="games"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <Games />
              </Suspense>
            }
          />
          <Route
            path="games/switch-search"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <SwitchSearch />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <NotFound />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
