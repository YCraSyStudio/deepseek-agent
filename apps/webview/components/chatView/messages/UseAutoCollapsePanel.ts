import { useEffect, useRef, useState } from "react";

export function useAutoCollapsePanel(isLive: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(isLive);
  const wasLiveRef = useRef(isLive);

  useEffect(() => {
    if (isLive) {
      setOpen(true);
    } else if (wasLiveRef.current) {
      setOpen(false);
    }
    wasLiveRef.current = isLive;
  }, [isLive]);

  return [open, setOpen];
}
