"use client";

import { useCallback, useState } from "react";

/** Width of an element in CSS pixels, tracked with a ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const [width, setWidth] = useState(fallback);

  const ref = useCallback((node: T | null) => {
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
