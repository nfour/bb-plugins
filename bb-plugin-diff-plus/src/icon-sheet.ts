// The file and folder icons' stylesheet (generated into icons-css.ts) is not
// loaded with the page: it is parsed and adopted the first time a Diff tab shows.
let loading: Promise<void> | null = null;

export function loadIconSheet(): Promise<void> {
  loading ??= import("./icons-css").then(({ default: text }) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  return loading;
}
