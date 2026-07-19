import type { RecipeInputKind } from "./types";

export const RECIPE_UPLOAD_ACCEPT = ".txt,.md,.pdf,.docx,.odt,.jpg,.jpeg,.png,.webp,text/plain,text/markdown,application/pdf,image/jpeg,image/png,image/webp";

const MEDIA_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const EXTENSION_MEDIA_TYPE: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function resolveRecipeUploadMediaType(file: { name: string; type: string }): string | null {
  const reported = file.type.trim().toLowerCase();
  if (MEDIA_TYPES.has(reported)) return reported;
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension ? EXTENSION_MEDIA_TYPE[extension] ?? null : null;
}

export function recipeInputKindForMediaType(mediaType: string): RecipeInputKind {
  return mediaType.startsWith("image/") ? "image" : mediaType.startsWith("text/") ? "text" : "document";
}
