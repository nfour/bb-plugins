/** Small line icons for the hover note, drawn in a 24-unit square with a 2px stroke; one `d` each. */
export const ICONS: Record<string, string> = {
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20c0-4 3.6-6 8-6s8 2 8 6",
  agent: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM19 16v4M17 18h4",
  command: "M4 5h16v14H4ZM7.5 9.5l3 2.5-3 2.5M13 15h4",
  read: "M6 3h8l4 4v14H6ZM14 3v4h4M9 12h6M9 16h6",
  edit: "M4 20l1-4L16 5l3 3L8 19ZM14 7l3 3",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5L20 20",
  web: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3Z",
  image: "M4 5h16v14H4ZM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM4 17l5-5 4 4 3-3 4 4",
  plan: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  approval: "M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6Z",
  tool: "M13 3L5 14h6l-1 7 8-11h-6Z",
  worked: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12l3 3 5-6",
  think: "M5 5h14v10H10l-4 4v-4H5ZM9 10h.01M12 10h.01M15 10h.01",
  error: "M12 4l9 16H3ZM12 10v4M12 17h.01",
  note: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
};

/** The icon for a kind of row when its item names none. */
export const KIND_ICON = { user: "user", reply: "agent", work: "tool", error: "error", system: "note" } as const;

/** The icon for a work row, by the kind of work. */
export function workIcon(workKind: unknown): string {
  switch (workKind) {
    case "command": return "command";
    case "file-read": return "read";
    case "file-change": return "edit";
    case "search":
    case "web-search": return "search";
    case "web-fetch": return "web";
    case "image-view":
    case "image-generation": return "image";
    case "plan-steps": return "plan";
    case "approval": return "approval";
    default: return "tool";
  }
}
