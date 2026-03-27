import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { GalleryPage } from "./pages/GalleryPage";
import { CardPage } from "./pages/CardPage";
import { EditPage } from "./pages/EditPage";
import { CreatePage } from "./pages/CreatePage";
import { AboutPage } from "./pages/AboutPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<GalleryPage />} />
          <Route path="card/:id" element={<CardPage />} />
          <Route path="card/:id/edit" element={<EditPage />} />
          <Route path="card/:id/copy" element={<EditPage mode="copy" />} />
          <Route path="create" element={<CreatePage />} />
          <Route path="about" element={<AboutPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
