import { useEffect, useRef, useState, type ReactNode } from "react";

// Renders `children` only once the wrapper scrolls near the viewport, so heavy sections
// (and their data fetches / code-split bundles) stay deferred until needed (PRD §7.4).
export function LazyInView({
  children,
  placeholder,
  rootMargin = "300px",
  minHeight = 160,
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  rootMargin?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootMargin]);

  return <div ref={ref}>{shown ? children : placeholder ?? <div style={{ minHeight }} />}</div>;
}
