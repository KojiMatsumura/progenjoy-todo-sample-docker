"use client";

export type DependencyManifest = {
  libraries?: Record<string, string>;
};

const scriptLoadCache = new Map<string, Promise<void>>();

function loadScriptOnce(src: string): Promise<void> {
  const cached = scriptLoadCache.get(src);
  if (cached) return cached;

  const p = new Promise<void>((resolve, reject) => {
    const exists = document.querySelector('script[data-ext-src="' + src + '"]');
    if (exists) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.extSrc = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("依存ライブラリの読込に失敗: " + src));
    document.head.appendChild(script);
  });
  scriptLoadCache.set(src, p);
  return p;
}

async function loadLibraryGlobal(
  libraryName: string,
  version: string
): Promise<void> {
  const src =
    "/api/program-library?name=" +
    encodeURIComponent(libraryName) +
    "&version=" +
    encodeURIComponent(version);
  await loadScriptOnce(src);
}

export async function loadLibrariesFromManifest(
  manifest: DependencyManifest
): Promise<void> {
  const entries = Object.entries(manifest.libraries ?? {});
  for (const [name, version] of entries) {
    const v = version.trim();
    if (!v) {
      throw new Error(
        name + " のバージョンが空です（dependencies.json の libraries）"
      );
    }
    await loadLibraryGlobal(name, v);
  }
}

