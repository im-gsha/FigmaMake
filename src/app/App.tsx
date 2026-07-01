import { useState } from "react";
import ShiftMain from "./components/shift/ShiftMain";
import ShiftText from "./components/shift/ShiftText";

type View = "main" | "text";

export default function App() {
  const [view, setView] = useState<View>("main");

  if (view === "text") {
    return <ShiftText onBack={() => setView("main")} />;
  }
  return <ShiftMain onNavigateToText={() => setView("text")} />;
}
