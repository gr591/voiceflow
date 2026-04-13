import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

interface OverlayPosition {
  x: number;
  y: number;
}

interface VisibilityState {
  visible: boolean;
  position: OverlayPosition | null;
}

export function useOverlayVisibility(): VisibilityState {
  const [state, setState] = useState<VisibilityState>({
    // Start visible in dev mode so WS2 can work without hotkey
    visible: true,
    position: null,
  });

  useEffect(() => {
    const unlistenShow = listen<OverlayPosition | null>(
      "overlay://show",
      (event) => {
        setState({ visible: true, position: event.payload });
      }
    );
    const unlistenHide = listen<null>("overlay://hide", () => {
      setState({ visible: false, position: null });
    });

    return () => {
      unlistenShow.then((f) => f()).catch(console.error);
      unlistenHide.then((f) => f()).catch(console.error);
    };
  }, []);

  return state;
}
