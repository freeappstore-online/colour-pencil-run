import type { ReactNode } from "react";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <>
      {/* Desktop layout */}
      <div className="hidden md:flex h-screen">
        <aside
          className="flex flex-col border-r h-full shrink-0"
          style={{ width: "17rem", borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <div className="p-6" style={{ fontFamily: "Fraunces, serif" }}>
            <div className="font-bold text-lg" style={{ color: "var(--ink)" }}>✏️ Colour Pencil Run</div>
            <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>Endless flap runner</div>
          </div>
          <nav className="flex-1 px-4 space-y-1">
            <div
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              <span>🎮</span> Play
            </div>
            <div className="px-3 py-4 text-xs" style={{ color: "var(--muted)" }}>
              <p className="font-semibold mb-1" style={{ color: "var(--ink)" }}>How to play</p>
              <ul className="space-y-1 leading-relaxed">
                <li>• Tap or press <kbd className="px-1 py-0.5 rounded text-xs" style={{ background: "var(--line)", color: "var(--ink)" }}>Space</kbd> to flap</li>
                <li>• Dodge the pencil bars</li>
                <li>• Pass a bar to change colour</li>
                <li>• The game speeds up over time!</li>
              </ul>
            </div>
          </nav>
          <div className="p-4 text-xs" style={{ color: "var(--muted)" }}>
            <a
              href="https://freeappstore.online"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              style={{ color: "var(--muted)" }}
            >
              Part of FreeAppStore — free forever
            </a>
          </div>
        </aside>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>

      {/* Mobile layout */}
      <div className="flex flex-col h-screen md:hidden">
        <header
          className="flex items-center px-4 h-14 border-b shrink-0 gap-2"
          style={{ borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <span>✏️</span>
          <span className="font-bold" style={{ fontFamily: "Fraunces, serif" }}>Colour Pencil Run</span>
        </header>
        <main className="flex-1 overflow-auto p-3">{children}</main>
        <nav
          className="flex items-center justify-around h-14 border-t shrink-0 text-xs"
          style={{ borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <div className="flex flex-col items-center gap-0.5" style={{ color: "var(--accent)" }}>
            <span className="text-lg">🎮</span>
            <span>Play</span>
          </div>
          <a
            href="https://freeappstore.online"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-0.5"
            style={{ color: "var(--muted)" }}
          >
            <span className="text-lg">🏪</span>
            <span>Store</span>
          </a>
        </nav>
      </div>
    </>
  );
}
