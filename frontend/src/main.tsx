import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import Dashboard from "./pages/Dashboard";
import Tailor from "./pages/Tailor";
import Applications from "./pages/Applications";
import Gaps from "./pages/Gaps";
import Interview from "./pages/Interview";
import Learning from "./pages/Learning";
import ProfilePage from "./pages/Profile";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Dashboard />} />
              <Route path="tailor" element={<Tailor />} />
              <Route path="applications" element={<Applications />} />
              <Route path="gaps" element={<Gaps />} />
              <Route path="interview" element={<Interview />} />
              <Route path="learning" element={<Learning />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>
);
