import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { GalleryPage } from "./pages/GalleryPage";
import { CardPage } from "./pages/CardPage";
import { EditPage } from "./pages/EditPage";
import { CreatePage } from "./pages/CreatePage";
import { AboutPage } from "./pages/AboutPage";

// EditPage is keyed by :id so React unmounts/remounts when the card changes
// (e.g. /card/X/copy → /card/Y/edit after a remix). Same component class at
// sibling routes would otherwise be reused, leaking state like `currentId`
// across what should be two distinct card-editing sessions.
function EditPageRoute({ mode }: { mode?: "edit" | "copy" }) {
  const { id } = useParams<{ id: string }>();
  return <EditPage key={id} mode={mode} />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<GalleryPage />} />
          <Route path="card/:id" element={<CardPage />} />
          <Route path="card/:id/edit" element={<EditPageRoute />} />
          <Route path="card/:id/copy" element={<EditPageRoute mode="copy" />} />
          <Route path="create" element={<CreatePage />} />
          <Route path="about" element={<AboutPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
